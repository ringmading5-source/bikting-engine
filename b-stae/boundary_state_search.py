"""First/last/count candidate index plus bounded recursive interior verification."""
import json
from pattern_memory import encoded


class BoundaryStateSearch:
    def __init__(self,engine):
        self.db=engine.db
        self.db.executescript('''CREATE TABLE IF NOT EXISTS boundary_states
          (id INTEGER PRIMARY KEY, context TEXT NOT NULL, mode TEXT NOT NULL,
           first INTEGER NOT NULL, last INTEGER NOT NULL, count INTEGER NOT NULL,
           units TEXT NOT NULL, payload TEXT NOT NULL, source TEXT NOT NULL, reference TEXT,
           UNIQUE(context,mode,reference));
          CREATE INDEX IF NOT EXISTS boundary_signature
          ON boundary_states(context,mode,first,last,count);''')

    def validate(self,units,mode):
        if mode not in ('character','byte','symbol') or not isinstance(units,list) or not 1<=len(units)<=2048:
            raise ValueError('valid mode and 1..2048 numerical units required')
        maximum=255 if mode=='byte' else 0x10ffff if mode=='character' else 2**63-1
        if any(type(v) is not int or not 0<=v<=maximum for v in units):raise ValueError('bounded integer units required')

    def observe(self,units,payload,source,context=None,mode='character',reference=None):
        self.validate(units,mode)
        if not isinstance(source,str) or not 1<=len(source)<=256:raise ValueError('bounded source required')
        payload=encoded(payload)
        if len(payload)>8192:raise ValueError('bounded payload required')
        ref=None if reference is None else encoded(reference)
        with self.db:
            cursor=self.db.execute('INSERT OR IGNORE INTO boundary_states(context,mode,first,last,count,units,payload,source,reference) VALUES (?,?,?,?,?,?,?,?,?)',
                                   (encoded(context),mode,units[0],units[-1],len(units),encoded(units),payload,source,ref))
            if cursor.rowcount:return cursor.lastrowid
            row=self.db.execute('SELECT * FROM boundary_states WHERE context=? AND mode=? AND reference=?',(encoded(context),mode,ref)).fetchone()
            if row['units']!=encoded(units) or row['payload']!=payload or row['source']!=source:raise ValueError('reference already identifies different evidence')
            return row['id']

    def verify(self,left,right,budget):
        def visit(start,stop):
            if budget['visited']>=budget['maximum']:return None
            budget['visited']+=1
            if left[start]!=right[start] or left[stop-1]!=right[stop-1]:return False
            if stop-start<=2:return True
            middle=(start+stop)//2
            a=visit(start,middle)
            if a is not True:return a
            return visit(middle,stop)
        if len(left)!=len(right):
            if budget['visited']>=budget['maximum']:return None
            budget['visited']+=1;return False
        return visit(0,len(left))

    def search(self,units,context=None,mode='character',strategy='indexed',max_candidates=2048,max_nodes=65536):
        self.validate(units,mode)
        if strategy not in ('indexed','scan') or type(max_candidates) is not int or not 1<=max_candidates<=10000 or type(max_nodes) is not int or not 1<=max_nodes<=1000000:
            raise ValueError('valid strategy and search bounds required')
        args=[encoded(context),mode];condition='context=? AND mode=?'
        total=self.db.execute('SELECT count(*) FROM boundary_states WHERE '+condition,args).fetchone()[0]
        if strategy=='indexed':condition+=' AND first=? AND last=? AND count=?';args.extend([units[0],units[-1],len(units)])
        possible=self.db.execute('SELECT count(*) FROM boundary_states WHERE '+condition,args).fetchone()[0]
        rows=self.db.execute('SELECT * FROM boundary_states WHERE '+condition+' ORDER BY id LIMIT ?',args+[max_candidates])
        matches=[];rejected=0;tested=0;limited=possible>max_candidates;budget={'visited':0,'maximum':max_nodes}
        for row in rows:
            good=self.verify(units,json.loads(row['units']),budget);tested+=1
            if good is None:limited=True;break
            if good:matches.append({'id':row['id'],'payload':json.loads(row['payload']),'source':row['source'],'interior_verified':True})
            else:rejected+=1
        return {'status':'bounded' if limited else 'matched' if matches else 'unknown','matches':matches,
                'signature':{'first':units[0],'last':units[-1],'count':len(units)},'strategy':strategy,
                'total_states':total,'candidate_states':possible,'tested_states':tested,'rejected_states':rejected,
                'recursive_nodes_visited':budget['visited'],'search_limited':limited,
                'scope':'Exact sequence retrieval after recursive verification; not semantic equivalence or new-rule discovery.'}
