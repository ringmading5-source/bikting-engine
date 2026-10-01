"""Bounded synthesis of sequence programs from observations, not named tasks.

The programmed hypothesis language includes slices, literals and numeric polynomials.
Search is intentionally bounded; this is not arbitrary behavior discovery.
Every generated hypothesis and its supporting/conflicting observations stays.
"""
import json
from fractions import Fraction
from pattern_memory import encoded


def apply(program, units):
    result = []
    for part in program:
        if part['kind'] == 'literal':
            result.extend(part['units'])
        elif part['kind'] == 'polynomial':
            if any(type(x) not in (int,float) for x in units):
                raise ValueError('numeric program requires numeric units')
            coefficients=[Fraction(*pair) for pair in part['coefficients']]
            for unit in units:
                value=sum((c*Fraction(str(unit))**power for power,c in enumerate(coefficients)),Fraction(0))
                result.append(float(value) if part.get('output_type')=='float' else value.numerator if value.denominator==1 else float(value))
        else:
            def endpoint(expr):
                return None if expr is None else expr[0]*len(units)+expr[1]
            result.extend(units[slice(endpoint(part['start']),endpoint(part['stop']),part['step'])])
    return result


def numeric_fragments(before, after):
    """Fit degrees 0..2 with exact rational arithmetic; keep every exact fit."""
    if len(before)!=len(after) or not before or any(type(x) not in (int,float) for x in before+after):
        return []
    pairs=list(dict.fromkeys((Fraction(str(x)),Fraction(str(y))) for x,y in zip(before,after)))
    if len({x for x,y in pairs})!=len(pairs): return []
    programs=[]
    for degree in range(3):
        size=degree+1
        if len(pairs)<size: continue
        matrix=[[x**power for power in range(size)]+[y] for x,y in pairs[:size]]
        for col in range(size):
            pivot=next((r for r in range(col,size) if matrix[r][col]),None)
            if pivot is None: break
            matrix[col],matrix[pivot]=matrix[pivot],matrix[col]
            divisor=matrix[col][col]; matrix[col]=[v/divisor for v in matrix[col]]
            for row in range(size):
                if row!=col:
                    scale=matrix[row][col]
                    matrix[row]=[a-scale*b for a,b in zip(matrix[row],matrix[col])]
        else:
            coefficients=[matrix[i][-1] for i in range(size)]
            if all(sum((c*x**p for p,c in enumerate(coefficients)),Fraction(0))==y for x,y in pairs):
                part={'kind':'polynomial','coefficients':[[c.numerator,c.denominator] for c in coefficients],
                      'output_type':'float' if any(type(y) is float for y in after) else 'integer_or_fraction'}
                if encoded(apply([part],before))==encoded(after): programs.append(part)
    return programs


class RelationshipDiscovery:
    def __init__(self, engine):
        self.memory = engine.patterns
        self.db = engine.db
        self.db.execute('''CREATE TABLE IF NOT EXISTS discovered_sequence_programs (
            level TEXT NOT NULL, context TEXT NOT NULL, program TEXT NOT NULL,
            PRIMARY KEY(level,context,program))''')

    def discover(self, level, context=None, max_programs=512, max_parts=2, max_stride=4, endpoint_radius=3):
        if type(max_programs) is not int or not 1 <= max_programs <= 4096:
            raise ValueError('max_programs must be 1..4096')
        if type(max_parts) is not int or not 1 <= max_parts <= 3:
            raise ValueError('max_parts must be 1..3')
        if type(max_stride) is not int or not 1 <= max_stride <= 16:
            raise ValueError('max_stride must be 1..16')
        if type(endpoint_radius) is not int or not 0 <= endpoint_radius <= 8:
            raise ValueError('endpoint_radius must be 0..8')
        rows = list(self.db.execute('SELECT * FROM pattern_examples WHERE level=? AND context=? ORDER BY id',
                                   (level,encoded(context))))
        endpoints = [None,[0,0],[1,0]] + [[0,i] for i in range(1,endpoint_radius+1)] + [[1,-i] for i in range(1,endpoint_radius+1)]
        generated = set()
        limited = False
        # Breadth-first across program lengths avoids favoring a complex fit.
        for row in rows:
            before, after = json.loads(row['before_units']), json.loads(row['after_units'])
            target = [encoded(x) for x in after]
            fragments = []
            for start in endpoints:
                for stop in endpoints:
                    for step in [v for stride in range(1,max_stride+1) for v in (stride,-stride)]:
                        part={'kind':'slice','start':start,'stop':stop,'step':step}
                        output=apply([part],before)
                        if output:
                            fragments.append((part,[encoded(x) for x in output]))
            for part in numeric_fragments(before,after):
                fragments.append((part,[encoded(x) for x in apply([part],before)]))
            # Literal vocabulary comes from observed output, not supplied answers.
            for token in {encoded(x) for x in after}:
                fragments.append(({'kind':'literal','units':[json.loads(token)]},[token]))
            frontier=[([],0)]
            found=set()
            expansions=0
            for depth in range(max_parts):
                next_frontier=[]
                for program, offset in frontier:
                    for part, output in fragments:
                        expansions+=1
                        if expansions > 100000:
                            limited=True; break
                        if target[offset:offset+len(output)] != output:
                            continue
                        candidate=program+[part]; end=offset+len(output)
                        if end==len(target):
                            found.add(encoded(candidate))
                            if len(found)>=max_programs:
                                limited=True; break
                        elif depth+1<max_parts:
                            next_frontier.append((candidate,end))
                    if limited and (len(found)>=max_programs or expansions>100000): break
                if len(found)>=max_programs or expansions>100000: break
                frontier=next_frontier
            if not after:
                found.add(encoded([]))
            generated.update(found)
        with self.db:
            self.db.executemany('INSERT OR IGNORE INTO discovered_sequence_programs VALUES (?,?,?)',
                               [(level,encoded(context),program) for program in sorted(generated)])
        return {'status':'bounded' if limited else 'searched', 'generated':len(generated),
                'hypotheses':self.inventory(level,context), 'search_limited':limited,
                'scope':'Slices, strides, literals and fitted numeric polynomials of degree 0..2.',
                'bounds':{'max_parts':max_parts,'max_programs_per_example':max_programs,'max_stride':max_stride,'endpoint_radius':endpoint_radius}}

    def inventory(self, level, context=None):
        examples=list(self.db.execute('SELECT * FROM pattern_examples WHERE level=? AND context=?',
                                      (level,encoded(context))))
        hypotheses=[]
        for row in self.db.execute('SELECT program FROM discovered_sequence_programs WHERE level=? AND context=? ORDER BY program',
                                   (level,encoded(context))):
            program=json.loads(row['program']); supporting=[]; conflicting=[]; lengths=set(); inputs=set()
            for example in examples:
                before=json.loads(example['before_units'])
                try: good=encoded(apply(program,before))==example['after_units']
                except (ValueError,OverflowError): good=False
                (supporting if good else conflicting).append(example['id'])
                if good:
                    lengths.add(len(before)); inputs.add(example['before_units'])
            hypotheses.append({'program':program,'supporting':supporting,'conflicting':conflicting,
                               'eligible':len(inputs)>=2 and len(lengths)>=2,
                               'complexity':len(program)})
        return hypotheses

    def predict(self, units, level, context=None):
        self.memory.validate(units)
        candidates={}
        for hypothesis in self.inventory(level,context):
            if not hypothesis['eligible']: continue
            try: output=apply(hypothesis['program'],units)
            except (ValueError,OverflowError): continue
            candidate=candidates.setdefault(encoded(output),{'units':output,'hypotheses':[]})
            candidate['hypotheses'].append(hypothesis)
        values=list(candidates.values())
        values.sort(key=lambda c:(-max(len(h['supporting']) for h in c['hypotheses']),encoded(c['units'])))
        return {'status':'unknown' if not values else 'predicted' if len(values)==1 else 'ambiguous',
                'candidates':values,'verified':False,
                'scope':'Bounded slice/literal/polynomial synthesis; hypotheses may extrapolate incorrectly.'}
