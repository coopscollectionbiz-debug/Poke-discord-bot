// Shared loader: joins pokemonData.json (live tiers) with the Nov 9 audit catalog (BST, catch rate, status, owners).
const fs=require('fs'),path=require('path');
function parseCSV(t){const rows=[];let r=[],f='',q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c=='"'){if(t[i+1]=='"'){f+='"';i++}else q=false}else f+=c}else if(c=='"')q=true;else if(c==','){r.push(f);f=''}else if(c=='\n'){r.push(f);rows.push(r);r=[];f=''}else if(c!='\r')f+=c}if(f||r.length){r.push(f);rows.push(r)}return rows}
module.exports=function load(){
  const root=path.join(__dirname,'../../..');
  const data=require(path.join(root,'pokemonData.json'));
  const rows=parseCSV(fs.readFileSync(path.join(__dirname,'source-catalog-2026-11-09.csv'),'utf8'));
  const h=rows[0];const cat={};for(const r of rows.slice(1)){const o={};h.forEach((k,i)=>o[k]=r[i]);cat[o.dex]=o}
  return Object.values(data).map(p=>{const c=cat[p.id]||{};return {...p,stage:+c.evolution_stage,root:c.family_root,status:c.special_status,bst:+c.bst,capture:+c.capture_rate,rule:c.gen6plus_rule_tier,owners:+c.owners||0,copies:+c.copies_owned||0,catTier:c.current_tier}});
};
