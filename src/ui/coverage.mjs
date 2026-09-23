export function coverageLines(decision){
  if(!decision)return [];
  return decision.allCandidates.filter(o=>o.kind==='upgrade' && (o.disabled || !o.effect))
    .sort((a,b)=>Number(b.affordable)-Number(a.affordable)||Number(a.disabled)-Number(b.disabled))
    .map(o=>{
    const name=o.displayName??o.internalName??o.id;
    const reason=o.disabled?'購入対象外：特殊操作・購入条件が未対応':o.affordable?'購入可能ですが、間接効果をまだ評価できません':o.eligible?'資金待ち・効果未評価':'未解禁・効果未評価';
    return `${name} — ${reason}`;
  });
}
