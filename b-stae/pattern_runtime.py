"""Outcome feedback, goal-aware selection, and bounded learned composition.

Only in-memory sequence transformations execute. Matching a supplied target
verifies sequence equality, not the correctness of a real-world decision.
"""
import hashlib
import json
from collections import deque
from pattern_memory import encoded
from relationship_discovery import apply


def program_id(program):
    return hashlib.sha256(encoded(program).encode()).hexdigest()


class PatternRuntime:
    def __init__(self, engine):
        self.memory=engine.patterns
        self.discovery=engine.discovery_patterns
        self.db=engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS pattern_outcomes (
          id INTEGER PRIMARY KEY, level TEXT NOT NULL, context TEXT NOT NULL,
          program TEXT NOT NULL, input_units TEXT NOT NULL, predicted TEXT NOT NULL,
          actual TEXT NOT NULL, goal TEXT NOT NULL, source TEXT NOT NULL,
          prediction_matched INTEGER NOT NULL, goal_matched INTEGER)''')

    def feedback(self, units, actual, program, level, source, context=None, goal=None):
        self.memory.validate(units);self.memory.validate(actual)
        if not isinstance(source,str) or not source.strip():raise ValueError('feedback source required')
        if goal is not None:self.memory.validate(goal)
        if self.db.execute('SELECT 1 FROM discovered_sequence_programs WHERE level=? AND context=? AND program=?',
                           (level,encoded(context),encoded(program))).fetchone() is None:
            raise ValueError('program must be a discovered hypothesis in this context')
        predicted=apply(program,units)
        match=encoded(predicted)==encoded(actual)
        goal_match=None if goal is None else encoded(actual)==encoded(goal)
        # Feedback is evidence, not a command to overwrite or delete a hypothesis.
        with self.db:
            ident=self.db.execute('''INSERT INTO pattern_outcomes
              (level,context,program,input_units,predicted,actual,goal,source,prediction_matched,goal_matched)
              VALUES (?,?,?,?,?,?,?,?,?,?)''',
              (level,encoded(context),encoded(program),encoded(units),encoded(predicted),encoded(actual),
               encoded(goal),source,int(match),None if goal_match is None else int(goal_match))).lastrowid
        self.memory.observe(units,level,source,context)
        self.memory.observe(actual,level,source,context)
        return {'outcome':ident,'prediction_matched':match,'goal_matched':goal_match,
                'program_id':program_id(program),'evidence_retained':True,
                'scope':'Comparison to supplied outcome; its source is not independently verified.'}

    def outcomes(self, level, context=None):
        return [dict(row) for row in self.db.execute('SELECT * FROM pattern_outcomes WHERE level=? AND context=? ORDER BY id',
                                                     (level,encoded(context)))]

    def hypotheses(self, level, context=None, goal=None):
        feedback=self.outcomes(level,context)
        values=[]
        for hypothesis in self.discovery.inventory(level,context):
            program=hypothesis['program']; key=encoded(program)
            # Program accuracy transfers within explicit context. Goal success is
            # only transferred when the exact goal contract matches.
            evidence=feedback
            good=0
            for outcome in evidence:
                try: matched=encoded(apply(program,json.loads(outcome['input_units'])))==outcome['actual']
                except (ValueError,OverflowError): matched=False
                good+=int(matched)
            bad=len(evidence)-good
            relevant=[r for r in evidence if r['program']==key and goal is not None and r['goal']==encoded(goal)]
            goal_good=sum(r['goal_matched']==1 for r in relevant)
            goal_bad=sum(r['goal_matched']==0 for r in relevant)
            values.append(dict(hypothesis,program_id=program_id(program),
                               feedback_success=good,feedback_failure=bad,
                               goal_success=goal_good,goal_failure=goal_bad,
                               score=len(hypothesis['supporting'])-len(hypothesis['conflicting'])+good-2*bad+goal_good-goal_bad))
        return values

    def select(self, units, level, context=None, goal=None):
        self.memory.validate(units)
        if goal is not None:self.memory.validate(goal)
        candidates={}
        for hypothesis in self.hypotheses(level,context,goal):
            if not hypothesis['eligible']:continue
            try: output=apply(hypothesis['program'],units)
            except (ValueError,OverflowError):continue
            candidate=candidates.setdefault(encoded(output),{'units':output,'hypotheses':[],
                        'goal_matched':None if goal is None else encoded(output)==encoded(goal)})
            candidate['hypotheses'].append(hypothesis)
        values=list(candidates.values())
        for c in values:
            c['score']=max(h['score'] for h in c['hypotheses'])
            c['complexity']=min(h['complexity'] for h in c['hypotheses'] if h['score']==c['score'])
        values.sort(key=lambda c:(not c['goal_matched'] if goal is not None else False,-c['score'],c['complexity'],encoded(c['units'])))
        if goal is not None:
            preferred=[c for c in values if c['goal_matched']]
        else:
            preferred=[c for c in values if (c['score'],c['complexity'])==(values[0]['score'],values[0]['complexity'])] if values else []
        return {'status':'unknown' if not values else 'goal_unmet' if goal is not None and not preferred else
                         'selected' if len(preferred)==1 else 'ambiguous',
                'preferred':preferred,'candidates':values,'outcome_verified':False,
                'scope':'Ranked hypotheses; provided target equality is not observed success.'}

    def plan(self, units, target, level, contexts, max_depth=4, max_nodes=256, max_units=128):
        self.memory.validate(units);self.memory.validate(target)
        if not isinstance(contexts,list) or not 1<=len(contexts)<=16:raise ValueError('1..16 explicit contexts required')
        for value,low,high in ((max_depth,0,8),(max_nodes,1,4096),(max_units,1,1024)):
            if type(value) is not int or not low<=value<=high:raise ValueError('invalid planning bounds')
        if len(units)>max_units or len(target)>max_units:raise ValueError('input/target exceed max_units')
        bank=[]
        for context in contexts:
            hypotheses=[h for h in self.hypotheses(level,context) if h['eligible']]
            if not hypotheses:continue
            # Attention chooses best evidence for this search. All others stay
            # in inventory, and this restriction is reported to the caller.
            best=max(h['score'] for h in hypotheses)
            for h in hypotheses:
                if h['score']==best:bank.append((context,h))
        bank.sort(key=lambda pair:(pair[1]['complexity'],pair[1]['program_id']))
        frontier=deque([(units,[])]); seen={encoded(units)};expanded=0;truncated=False
        while frontier:
            state,path=frontier.popleft()
            if encoded(state)==encoded(target):
                return {'status':'predicted_goal_matched','result':state,'plan':path,'expanded':expanded,
                        'target_equality_verified':True,'outcome_verified':False,
                        'search_limited':truncated,'scope':'Composition of learned sequence hypotheses; no external actions.'}
            if len(path)>=max_depth:
                truncated=True;continue
            if expanded>=max_nodes:
                truncated=True;break
            expanded+=1
            successors={}
            for context,h in bank:
                try: after=apply(h['program'],state)
                except (ValueError,OverflowError):continue
                if len(after)>max_units:
                    truncated=True;continue
                key=encoded(after)
                if key in seen:continue
                successors.setdefault(key,(after,context,h))
            for key,(after,context,h) in successors.items():
                if len(seen)>=max_nodes:
                    truncated=True;break
                seen.add(key)
                step={'before':state,'after':after,'context':context,'program':h['program'],
                      'program_id':h['program_id'],'supporting':h['supporting'],'conflicting':h['conflicting']}
                frontier.append((after,path+[step]))
        return {'status':'bounded' if truncated else 'unreachable_with_selected_hypotheses','plan':[],
                'expanded':expanded,'search_limited':truncated,'outcome_verified':False,
                'scope':'Best-scoring eligible programs per context only; failure is not proof of impossibility.'}
