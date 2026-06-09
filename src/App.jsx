import { useState, useEffect, useMemo, useRef } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Legend } from "recharts";
import * as XLSX from "https://cdn.sheetjs.com/xlsx-0.20.1/package/xlsx.mjs";

const COLORS = ["#378ADD","#1D9E75","#D85A30","#BA7517","#7F77DD","#D4537E","#639922","#E24B4A","#888780","#0F6E56","#185FA5","#3B6D11"];
const DEFAULT_SUPPLIERS = ["대한제분","CJ제일제당","서울우유","풀무원","오뚜기","롯데푸드","동원F&B","해태제과","농심","직접구매","기타"];
const SELL_UNITS = ["개","봉","kg"];
const PAGE_SIZE = 20;

function fmt(n){ return isNaN(n)||n==null?"-":Math.round(n).toLocaleString(); }
function fmtD(n,d=1){ return isNaN(n)||n==null?"-":Number(n).toFixed(d); }

function cpg(ing){
  if(!ing||!ing.price||!ing.buy_weight) return 0;
  const g = ing.buy_unit==="kg"||ing.buy_unit==="L" ? 1000 : 1;
  return ing.price / (ing.buy_weight * g);
}

// 판매단위 파싱: "7개*1봉" → {qty:7, unit:"봉"}, "1개" → {qty:1,unit:"개"}, "1kg" → {qty:1,unit:"kg"}
function parseSellUnit(val){
  if(!val) return {qty:1,unit:"개",display:val};
  if(val.includes("*")){
    const [a,b]=val.split("*");
    const qty=parseFloat(a)||1;
    const unit=b.replace(/[0-9]/g,"");
    return {qty,unit,display:val};
  }
  const num=parseFloat(val)||1;
  const unit=val.replace(/[0-9.]/g,"");
  return {qty:num,unit,display:val};
}

function calcRecipeFull(recipe, allIng, allRec, depth=0){
  if(depth>5) return {total:0,items:[],totalWeight:0};
  let total=0;
  const items=(recipe.items||[]).map(item=>{
    if(item.type==="ingredient"){
      const ing=allIng.find(i=>i.id===item.id);
      const cost=cpg(ing)*item.amount;
      total+=cost;
      return {...item,name:ing?.name||"?",supplier:ing?.supplier||"",unitCost:cpg(ing),cost,isRecipe:false};
    } else {
      const sub=allRec.find(r=>r.id===item.id);
      if(!sub) return {...item,name:"?",unitCost:0,cost:0,isRecipe:true};
      const sub2=calcRecipeFull(sub,allIng,allRec,depth+1);
      const subW=(sub.items||[]).reduce((s,i)=>s+(i.amount||0),0);
      const uCost=subW>0?sub2.total/subW:0;
      const cost=uCost*item.amount;
      total+=cost;
      return {...item,name:sub.name,unitCost:uCost,cost,isRecipe:true};
    }
  });
  const totalWeight=items.reduce((s,i)=>s+(i.amount||0),0);
  return {total,totalWeight,items:items.map(i=>({...i,weightRatio:totalWeight>0?i.amount/totalWeight*100:0,costRatio:total>0?i.cost/total*100:0}))};
}

// 판매단위 기준 원가
function calcSellUnitCost(recipe, allIng, allRec){
  const res=calcRecipeFull(recipe,allIng,allRec);
  const totalW=res.totalWeight;
  const totalCost=res.total;
  const su=parseSellUnit(recipe.sellUnit);
  const pw=parseFloat(recipe.pieceWeight)||0;
  if(!pw||!totalW) return {pieceCost:0,sellUnitCost:0,margin:0,pieceCount:0};
  const pieceCost=totalCost/(totalW/pw);
  let sellUnitCost=pieceCost;
  if(su.unit==="봉"||su.unit==="봉지") sellUnitCost=pieceCost*su.qty;
  else if(su.unit==="kg") sellUnitCost=totalCost/totalW*1000;
  const margin=recipe.salePrice>0?(recipe.salePrice-sellUnitCost)/recipe.salePrice*100:0;
  return {pieceCost,sellUnitCost,margin,pieceCount:totalW/pw,res};
}

const Btn=({onClick,children,variant="default",active,style={}})=>{
  const v={
    default:{background:active?"#378ADD":"#f0f0f0",color:active?"#fff":"#333",border:"none"},
    primary:{background:"#378ADD",color:"#fff",border:"none"},
    danger:{background:"#fef0f0",color:"#E24B4A",border:"1px solid #f7c1c1"},
    ghost:{background:"transparent",color:"#555",border:"1px solid #ddd"},
    success:{background:"#eaf3de",color:"#3B6D11",border:"1px solid #c0dd97"},
  };
  return <button onClick={onClick} style={{padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500,display:"inline-flex",alignItems:"center",gap:6,transition:"all 0.15s",...v[variant],...style}}>{children}</button>;
};
const Card=({children,style={}})=><div style={{background:"#fff",border:"1px solid #e8e8e8",borderRadius:12,padding:"1rem 1.25rem",...style}}>{children}</div>;
const Inp=({placeholder,value,onChange,type="text",style={}})=>(
  <input type={type} placeholder={placeholder} value={value} onChange={onChange}
    style={{padding:"9px 12px",border:"1px solid #ddd",borderRadius:8,fontSize:13,width:"100%",boxSizing:"border-box",background:"#fafafa",color:"#222",...style}}/>
);
const Sel=({value,onChange,children,disabled,style={}})=>(
  <select value={value} onChange={onChange} disabled={disabled}
    style={{padding:"9px 12px",border:"1px solid #ddd",borderRadius:8,fontSize:13,width:"100%",background:disabled?"#f5f5f5":"#fafafa",color:disabled?"#aaa":"#222",...style}}>
    {children}
  </select>
);

function IngSearch({ingredients,value,onChange}){
  const [q,setQ]=useState("");
  const [open,setOpen]=useState(false);
  const ref=useRef();
  const selected=ingredients.find(i=>i.id===value);
  const names=[...new Set(ingredients.map(i=>i.name))];
  const filtered=q?names.filter(n=>n.toLowerCase().includes(q.toLowerCase())):names;
  useEffect(()=>{
    const fn=e=>{ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown",fn); return()=>document.removeEventListener("mousedown",fn);
  },[]);
  function selectName(name){ const first=ingredients.find(i=>i.name===name); onChange(first?.id||null,name); setQ(""); setOpen(false); }
  return(
    <div ref={ref} style={{position:"relative",flex:1}}>
      <div onClick={()=>setOpen(p=>!p)} style={{padding:"9px 12px",border:"1px solid #ddd",borderRadius:8,fontSize:13,background:"#fafafa",color:selected?"#222":"#aaa",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",userSelect:"none"}}>
        <span>{selected?selected.name:"재료 검색 또는 선택"}</span><span style={{fontSize:10,color:"#aaa"}}>▼</span>
      </div>
      {open&&(
        <div style={{position:"absolute",top:"calc(100% + 4px)",left:0,right:0,background:"#fff",border:"1px solid #ddd",borderRadius:8,boxShadow:"0 4px 16px rgba(0,0,0,0.12)",zIndex:100,maxHeight:220,display:"flex",flexDirection:"column"}}>
          <div style={{padding:"6px 8px",borderBottom:"1px solid #eee"}}>
            <input autoFocus placeholder="재료명 검색..." value={q} onChange={e=>setQ(e.target.value)}
              style={{width:"100%",padding:"6px 10px",border:"1px solid #eee",borderRadius:6,fontSize:13,boxSizing:"border-box",outline:"none"}}/>
          </div>
          <div style={{overflowY:"auto",maxHeight:160}}>
            {filtered.length===0?<div style={{padding:"12px",fontSize:13,color:"#aaa",textAlign:"center"}}>검색 결과 없음</div>
              :filtered.map(name=>(
                <div key={name} onClick={()=>selectName(name)}
                  style={{padding:"9px 14px",fontSize:13,cursor:"pointer",background:selected?.name===name?"#f0f7ff":"#fff",color:selected?.name===name?"#1a5fa8":"#222"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#f8f8f8"}
                  onMouseLeave={e=>e.currentTarget.style.background=selected?.name===name?"#f0f7ff":"#fff"}>
                  {name}
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PriceEdit({ing,onSave}){
  const [open,setOpen]=useState(false);
  const [p,setP]=useState(""); const [d,setD]=useState("");
  if(!open) return <button onClick={()=>setOpen(true)} style={{border:"1px solid #ddeeff",background:"#f5f9ff",color:"#1a5fa8",borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:12}}>단가수정</button>;
  return(
    <span style={{display:"inline-flex",gap:4,alignItems:"center"}}>
      <input type="number" placeholder="새단가" value={p} onChange={e=>setP(e.target.value)} style={{width:80,padding:"4px 6px",border:"1px solid #ddd",borderRadius:6,fontSize:12}}/>
      <input type="date" value={d} onChange={e=>setD(e.target.value)} style={{width:110,padding:"4px 6px",border:"1px solid #ddd",borderRadius:6,fontSize:12}}/>
      <button onClick={()=>{if(p){onSave(p,d);setOpen(false);setP("");setD("");}}} style={{border:"none",background:"#eaf3de",color:"#3B6D11",borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:12}}>저장</button>
      <button onClick={()=>setOpen(false)} style={{border:"none",background:"#f0f0f0",color:"#888",borderRadius:6,cursor:"pointer",padding:"4px 6px",fontSize:12}}>✕</button>
    </span>
  );
}

export default function App(){
  const [tab,setTab]=useState("재료");
  const [ingredients,setIngredients]=useState([]);
  const [recipes,setRecipes]=useState([]);
  const [supplierList,setSupplierList]=useState(DEFAULT_SUPPLIERS);
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);

  // 재료 폼
  const [newIng,setNewIng]=useState({name:"",supplier:"",buyUnit:"kg",buyWeight:"1",price:"",date:""});
  const [newSupInput,setNewSupInput]=useState("");
  const [showAddSup,setShowAddSup]=useState(false);

  // 재료 목록 뷰
  const [ingViewMode,setIngViewMode]=useState("전체");
  const [ingSearch,setIngSearch]=useState("");
  const [ingPage,setIngPage]=useState(1);
  const [selectedIngIds,setSelectedIngIds]=useState([]);

  // 엑셀 업로드
  const [xlsPreview,setXlsPreview]=useState([]);
  const [showXlsPreview,setShowXlsPreview]=useState(false);
  const xlsRef=useRef();

  // 레시피 폼
  const [newRecipe,setNewRecipe]=useState({name:"",pieceWeight:"",salePrice:"",sellUnit:"1개",sellUnitQty:"1",sellUnitType:"개",items:[],steps:[]});
  const [newStep,setNewStep]=useState("");
  const [addItem,setAddItem]=useState({type:"ingredient",ingName:"",ingId:null,recipeId:"",amount:""});
  const [recipeView,setRecipeView]=useState({});
  const [searchQ,setSearchQ]=useState("");

  useEffect(()=>{ loadAll(); },[]);

  async function loadAll(){
    setLoading(true);
    try{
      const [{data:ings},{data:recs},{data:sups}]=await Promise.all([
        supabase().from("ingredients").select("*").order("id"),
        supabase().from("recipes").select("*").order("id"),
        supabase().from("supplier_list").select("*").order("id"),
      ]);
      if(ings) setIngredients(ings);
      if(recs) setRecipes(recs.map(r=>({...r,items:r.items||[],steps:r.steps||[]})));
      if(sups) setSupplierList(sups.map(s=>s.name));
    }catch(e){console.error(e);}
    setLoading(false);
  }

  // Supabase 클라이언트 (런타임에 import)
  const [sb,setSb]=useState(null);
  useEffect(()=>{
    import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm").then(m=>{
      const client=m.createClient(
        "https://kskueunxzzurmtmqgvva.supabase.co",
        "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtza3VldW54enp1cm10bXFndnZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA5NDI0NzQsImV4cCI6MjA5NjUxODQ3NH0.8dV3grCO6kgjftdpvi7fqSFVSO7VrHAdAcvbwrNmfjo"
      );
      setSb(client);
    });
  },[]);
  function supabase(){ return sb; }

  async function addIngredient(){
    if(!sb||!newIng.name||!newIng.supplier||!newIng.price||!newIng.buyWeight) return;
    setSaving(true);
    const date=newIng.date||new Date().toISOString().slice(0,10);
    const ing={id:Date.now(),name:newIng.name,supplier:newIng.supplier,buy_unit:newIng.buyUnit,buy_weight:parseFloat(newIng.buyWeight),unit:"g",price:parseFloat(newIng.price),date,price_history:[{price:parseFloat(newIng.price),date}]};
    await sb.from("ingredients").insert(ing);
    setIngredients(p=>[...p,ing]);
    setNewIng({name:"",supplier:"",buyUnit:"kg",buyWeight:"1",price:"",date:""});
    setSaving(false);
  }

  async function addIngredientsFromXls(rows){
    if(!sb) return;
    setSaving(true);
    const ings=rows.map(r=>({
      id:Date.now()+Math.random(),
      name:String(r["재료명"]||"").trim(),
      supplier:String(r["구입처"]||"").trim(),
      buy_unit:String(r["구매단위"]||"kg").trim(),
      buy_weight:parseFloat(r["구매무게"])||1,
      unit:"g",
      price:parseFloat(r["구매단가"])||0,
      date:r["등록일"]?String(r["등록일"]).trim():new Date().toISOString().slice(0,10),
      price_history:[{price:parseFloat(r["구매단가"])||0,date:r["등록일"]?String(r["등록일"]).trim():new Date().toISOString().slice(0,10)}]
    })).filter(i=>i.name&&i.supplier);
    await sb.from("ingredients").insert(ings);
    setIngredients(p=>[...p,...ings]);
    setShowXlsPreview(false); setXlsPreview([]);
    setSaving(false);
  }

  function handleXlsFile(e){
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=ev=>{
      const wb=XLSX.read(ev.target.result,{type:"array"});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{defval:""});
      setXlsPreview(data); setShowXlsPreview(true);
    };
    reader.readAsArrayBuffer(file);
    e.target.value="";
  }

  function downloadTemplate(){
    const ws=XLSX.utils.aoa_to_sheet([
      ["재료명","구입처","구매단위","구매무게","구매단가","등록일"],
      ["박력분","대한제분","kg","1","1800","2025-01-01"],
      ["버터","서울우유","kg","1","12000","2025-01-01"],
    ]);
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,"재료목록");
    XLSX.writeFile(wb,"재료등록양식.xlsx");
  }

  async function updateIngPrice(id,newPrice,date){
    if(!sb) return;
    const d=date||new Date().toISOString().slice(0,10);
    const ing=ingredients.find(i=>i.id===id); if(!ing) return;
    const newHistory=[...(ing.price_history||[]),{price:parseFloat(newPrice),date:d}];
    await sb.from("ingredients").update({price:parseFloat(newPrice),date:d,price_history:newHistory}).eq("id",id);
    setIngredients(p=>p.map(i=>i.id===id?{...i,price:parseFloat(newPrice),date:d,price_history:newHistory}:i));
  }

  async function deleteIngredient(id){
    if(!sb) return;
    await sb.from("ingredients").delete().eq("id",id);
    setIngredients(p=>p.filter(i=>i.id!==id));
  }

  async function addSupplierToList(){
    if(!sb||!newSupInput.trim()||supplierList.includes(newSupInput.trim())) return;
    await sb.from("supplier_list").insert({name:newSupInput.trim()});
    setSupplierList(p=>[...p,newSupInput.trim()]);
    setNewSupInput(""); setShowAddSup(false);
  }

  async function removeSupplierFromList(name){
    if(!sb) return;
    await sb.from("supplier_list").delete().eq("name",name);
    setSupplierList(p=>p.filter(x=>x!==name));
  }

  // 판매단위 문자열 생성
  function buildSellUnit(qty,type){
    if(type==="개") return `${qty}개`;
    if(type==="봉") return `${qty}개*1봉`;
    if(type==="kg") return `${qty}kg`;
    return `${qty}${type}`;
  }

  async function saveRecipe(){
    if(!sb||!newRecipe.name||!newRecipe.items.length) return;
    setSaving(true);
    const sellUnit=buildSellUnit(newRecipe.sellUnitQty,newRecipe.sellUnitType);
    const r={...newRecipe,id:Date.now(),pieceWeight:parseFloat(newRecipe.pieceWeight)||0,salePrice:parseFloat(newRecipe.salePrice)||0,sellUnit};
    await sb.from("recipes").insert({id:r.id,name:r.name,piece_weight:r.pieceWeight,sale_price:r.salePrice,sell_unit:sellUnit,items:r.items,steps:r.steps});
    setRecipes(p=>[...p,r]);
    setNewRecipe({name:"",pieceWeight:"",salePrice:"",sellUnit:"1개",sellUnitQty:"1",sellUnitType:"개",items:[],steps:[]});
    setSaving(false);
  }

  async function deleteRecipe(id){
    if(!sb) return;
    await sb.from("recipes").delete().eq("id",id);
    setRecipes(p=>p.filter(r=>r.id!==id));
  }

  function toggleView(rid,key){ setRecipeView(p=>({...p,[rid]:{...p[rid],[key]:!p[rid]?.[key]}})); }

  function addItemToRecipe(){
    if(addItem.type==="ingredient"){ if(!addItem.ingId||!addItem.amount) return; setNewRecipe(p=>({...p,items:[...p.items,{type:"ingredient",id:addItem.ingId,amount:parseFloat(addItem.amount)}]})); }
    else { if(!addItem.recipeId||!addItem.amount) return; setNewRecipe(p=>({...p,items:[...p.items,{type:"recipe",id:parseInt(addItem.recipeId),amount:parseFloat(addItem.amount)}]})); }
    setAddItem(p=>({...p,ingId:null,ingName:"",recipeId:"",amount:""}));
  }

  // 재료 필터/페이지
  const supplierGroups=useMemo(()=>{ const m={}; ingredients.forEach(i=>{ if(!m[i.supplier]) m[i.supplier]=[]; m[i.supplier].push(i); }); return m; },[ingredients]);
  const allSupViews=["전체",...Object.keys(supplierGroups)];
  const filteredIngs=useMemo(()=>{
    let list=ingViewMode==="전체"?ingredients:(supplierGroups[ingViewMode]||[]);
    if(ingSearch.trim()) list=list.filter(i=>i.name.toLowerCase().includes(ingSearch.toLowerCase())||i.supplier.toLowerCase().includes(ingSearch.toLowerCase()));
    return list;
  },[ingredients,ingViewMode,supplierGroups,ingSearch]);
  const totalIngPages=Math.max(1,Math.ceil(filteredIngs.length/PAGE_SIZE));
  const pagedIngs=filteredIngs.slice((ingPage-1)*PAGE_SIZE,ingPage*PAGE_SIZE);
  useEffect(()=>setIngPage(1),[ingSearch,ingViewMode]);

  const priceChartData=useMemo(()=>{
    const sel=ingredients.filter(i=>selectedIngIds.includes(i.id));
    if(!sel.length) return [];
    const dates=[...new Set(sel.flatMap(i=>(i.price_history||[]).map(h=>h.date)))].sort();
    return dates.map(date=>{ const obj={date}; sel.forEach(i=>{ const e=(i.price_history||[]).filter(h=>h.date<=date); const k=`${i.name}(${i.supplier})`; if(e.length) obj[k]=e[e.length-1].price; }); return obj; });
  },[ingredients,selectedIngIds]);

  const sameNameIngs=useMemo(()=>{ if(!addItem.ingName) return []; return ingredients.filter(i=>i.name===addItem.ingName); },[addItem.ingName,ingredients]);

  const filteredRecipes=useMemo(()=>{
    if(!searchQ.trim()) return recipes;
    const q=searchQ.toLowerCase();
    return recipes.filter(r=>{ if(r.name.toLowerCase().includes(q)) return true; return (r.items||[]).some(item=>{ if(item.type==="ingredient") return ingredients.find(i=>i.id===item.id)?.name.toLowerCase().includes(q); return recipes.find(x=>x.id===item.id)?.name.toLowerCase().includes(q); }); });
  },[recipes,ingredients,searchQ]);

  const mgColor=mg=>mg>=60?"#1D9E75":mg>=40?"#BA7517":"#E24B4A";
  const mgBg=mg=>mg>=60?"#eaf3de":mg>=40?"#faeeda":"#fcebeb";

  // 인쇄
  function printSection(id){
    const el=document.getElementById(id);
    if(!el) return;
    const w=window.open("","_blank");
    w.document.write(`<html><head><title>인쇄</title><style>
      body{font-family:-apple-system,sans-serif;padding:20px;color:#111;}
      table{width:100%;border-collapse:collapse;font-size:13px;}
      th,td{padding:8px 10px;border:1px solid #ddd;text-align:left;}
      th{background:#f5f5f5;font-weight:600;}
      .recipe-card{margin-bottom:32px;page-break-inside:avoid;}
      .recipe-title{font-size:18px;font-weight:700;margin-bottom:12px;}
      .info-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:12px;}
      .info-box{border:1px solid #eee;border-radius:6px;padding:8px;}
      .info-label{font-size:11px;color:#888;}
      .info-value{font-size:15px;font-weight:700;}
      .steps{margin-top:12px;}
      .step{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid #f0f0f0;}
      .step-num{min-width:22px;height:22px;background:#BA7517;color:#fff;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;}
      @media print{body{padding:0;}}
    </style></head><body>${el.innerHTML}</body></html>`);
    w.document.close(); w.focus(); w.print(); w.close();
  }

  function exportCSV(){
    let csv="레시피 원가 관리\n\n=== 재료 목록 ===\n재료명,구입처,구매단위,구매무게,구매단가,원/g,등록일\n";
    for(const i of ingredients) csv+=`${i.name},${i.supplier},${i.buy_unit},${i.buy_weight},${i.price},${cpg(i).toFixed(4)},${i.date}\n`;
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="레시피원가.csv"; a.click();
  }

  if(loading||!sb) return(
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",flexDirection:"column",gap:12,background:"#f5f5f5"}}>
      <div style={{fontSize:32}}>🍞</div>
      <p style={{fontSize:14,color:"#888"}}>데이터 불러오는 중...</p>
    </div>
  );

  return(
    <div style={{fontFamily:"-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif",background:"#f5f5f5",minHeight:"100vh",paddingBottom:40}}>
      {/* 인쇄용 숨김 영역 */}
      <div id="print-ingredients" style={{display:"none"}}>
        <h2>재료 목록</h2>
        <table>
          <thead><tr><th>재료명</th><th>구입처</th><th>구매용량(g기준)</th><th>구매단위</th><th>구매단가</th></tr></thead>
          <tbody>{ingredients.map(i=><tr key={i.id}><td>{i.name}</td><td>{i.supplier}</td><td>{i.buy_weight*(i.buy_unit==="kg"||i.buy_unit==="L"?1000:1)}g</td><td>{i.buy_weight}{i.buy_unit}</td><td>{fmt(i.price)}원</td></tr>)}</tbody>
        </table>
      </div>
      <div id="print-recipes" style={{display:"none"}}>
        <h2>레시피 목록</h2>
        {recipes.map(r=>{
          const {pieceCost,sellUnitCost,margin,pieceCount,res}=calcSellUnitCost(r,ingredients,recipes);
          return(
            <div key={r.id} className="recipe-card">
              <div className="recipe-title">{r.name}</div>
              <div className="info-grid">
                <div className="info-box"><div className="info-label">1개 무게</div><div className="info-value">{r.pieceWeight}g</div></div>
                <div className="info-box"><div className="info-label">판매단위</div><div className="info-value">{r.sellUnit||"-"}</div></div>
                <div className="info-box"><div className="info-label">원가(판매단위)</div><div className="info-value">{fmtD(sellUnitCost)}원</div></div>
                <div className="info-box"><div className="info-label">판매가</div><div className="info-value">{fmt(r.salePrice)}원</div></div>
              </div>
              <table>
                <thead><tr><th>재료</th><th>사용량(g)</th><th>무게비율(%)</th><th>원가(원)</th><th>원가비율(%)</th></tr></thead>
                <tbody>{(res?.items||[]).map((item,idx)=><tr key={idx}><td>{item.name}{item.isRecipe?" [레시피]":""}</td><td>{item.amount}</td><td>{fmtD(item.weightRatio)}%</td><td>{fmtD(item.cost)}</td><td>{fmtD(item.costRatio)}%</td></tr>)}</tbody>
              </table>
              {r.steps&&r.steps.length>0&&<div className="steps"><strong>제조방법</strong>{r.steps.map((s,i)=><div key={i} className="step"><span className="step-num">{i+1}</span><span>{s}</span></div>)}</div>}
            </div>
          );
        })}
      </div>

      {/* Header */}
      <div style={{background:"#fff",borderBottom:"1px solid #e8e8e8",padding:"16px 20px 0"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <div>
            <h1 style={{fontSize:18,fontWeight:700,margin:0,color:"#111"}}>🍞 레시피 원가 관리</h1>
            <p style={{fontSize:12,color:"#888",margin:"3px 0 0"}}>재료 · 레시피 · 원가 · 마진 통합 관리{saving?" · 저장 중...":""}</p>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end"}}>
            <Btn onClick={exportCSV} variant="ghost">📊 엑셀</Btn>
            <Btn onClick={()=>printSection("print-ingredients")} variant="ghost">🖨️ 재료 인쇄</Btn>
            <Btn onClick={()=>printSection("print-recipes")} variant="ghost">🖨️ 레시피 인쇄</Btn>
          </div>
        </div>
        <div style={{display:"flex",gap:4}}>
          {["재료","레시피","분석"].map(t=>(
            <button key={t} onClick={()=>setTab(t)} style={{padding:"9px 22px",border:"none",borderRadius:"8px 8px 0 0",cursor:"pointer",fontSize:14,fontWeight:500,background:tab===t?"#378ADD":"transparent",color:tab===t?"#fff":"#666",borderBottom:tab===t?"3px solid #378ADD":"3px solid transparent",transition:"all 0.15s"}}>
              {t==="재료"?"🥕 재료":t==="레시피"?"📋 레시피":"📈 분석"}
            </button>
          ))}
        </div>
      </div>

      <div style={{padding:"20px"}}>

        {/* ===== 재료 탭 ===== */}
        {tab==="재료"&&(
          <div style={{display:"grid",gap:16}}>
            <Card>
              <p style={{fontWeight:700,fontSize:14,margin:"0 0 14px",color:"#222"}}>➕ 재료 추가</p>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:8}}>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>재료명</p><Inp placeholder="예: 박력분" value={newIng.name} onChange={e=>setNewIng(p=>({...p,name:e.target.value}))}/></div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>구입처</p>
                  <Sel value={newIng.supplier} onChange={e=>setNewIng(p=>({...p,supplier:e.target.value}))}>
                    <option value="">구입처 선택</option>
                    {supplierList.map(s=><option key={s} value={s}>{s}</option>)}
                  </Sel>
                </div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>등록일</p><Inp type="date" value={newIng.date} onChange={e=>setNewIng(p=>({...p,date:e.target.value}))}/></div>
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr auto",gap:8,marginBottom:12,alignItems:"end"}}>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>구매단위</p>
                  <Sel value={newIng.buyUnit} onChange={e=>setNewIng(p=>({...p,buyUnit:e.target.value}))}>
                    {["g","kg","ml","L","개"].map(u=><option key={u} value={u}>{u}</option>)}
                  </Sel>
                </div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>구매무게/용량</p><Inp type="number" placeholder="예: 1" value={newIng.buyWeight} onChange={e=>setNewIng(p=>({...p,buyWeight:e.target.value}))}/></div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>구매단가 (원)</p><Inp type="number" placeholder="예: 1800" value={newIng.price} onChange={e=>setNewIng(p=>({...p,price:e.target.value}))}/></div>
                <Btn onClick={addIngredient} variant="primary" style={{whiteSpace:"nowrap",padding:"9px 20px"}}>등록</Btn>
              </div>
              {newIng.buyWeight&&newIng.price&&(
                <div style={{background:"#f0f7ff",borderRadius:8,padding:"8px 14px",fontSize:12,color:"#1a5fa8",marginBottom:12}}>
                  💡 g당 단가: <strong>{(parseFloat(newIng.price)/(parseFloat(newIng.buyWeight)*(newIng.buyUnit==="kg"||newIng.buyUnit==="L"?1000:1))).toFixed(4)}</strong>원/g
                </div>
              )}

              {/* 엑셀 업로드 */}
              <div style={{background:"#f0f7ff",border:"1px solid #b5d4f4",borderRadius:10,padding:"12px 14px",marginBottom:12}}>
                <p style={{fontWeight:600,fontSize:13,margin:"0 0 8px",color:"#1a5fa8"}}>📂 엑셀로 재료 일괄 추가</p>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <Btn onClick={downloadTemplate} variant="ghost" style={{fontSize:12}}>📥 양식 다운로드</Btn>
                  <Btn onClick={()=>xlsRef.current.click()} variant="primary" style={{fontSize:12}}>📤 엑셀 업로드</Btn>
                  <input ref={xlsRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleXlsFile}/>
                </div>
                <p style={{fontSize:11,color:"#888",margin:"8px 0 0"}}>양식 다운로드 → 작성 → 업로드 순서로 진행하세요. 열 순서: 재료명, 구입처, 구매단위, 구매무게, 구매단가, 등록일</p>
              </div>

              {/* 구입처 목록 */}
              <div style={{background:"#f8f9fc",borderRadius:8,padding:"10px 12px"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                  <span style={{fontSize:12,fontWeight:600,color:"#555"}}>🏪 구입처 목록 관리</span>
                  <Btn onClick={()=>setShowAddSup(p=>!p)} variant="ghost" style={{fontSize:12,padding:"4px 10px"}}>{showAddSup?"닫기":"+ 추가"}</Btn>
                </div>
                {showAddSup&&(<div style={{display:"flex",gap:8,marginBottom:8}}><Inp placeholder="새 구입처명" value={newSupInput} onChange={e=>setNewSupInput(e.target.value)} style={{background:"#fff"}}/><Btn onClick={addSupplierToList} variant="success" style={{whiteSpace:"nowrap"}}>추가</Btn></div>)}
                <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                  {supplierList.map(s=>(
                    <div key={s} style={{display:"flex",alignItems:"center",gap:4,background:"#fff",border:"1px solid #e0e0e0",borderRadius:20,padding:"3px 10px"}}>
                      <span style={{fontSize:12,color:"#444"}}>{s}</span>
                      <button onClick={()=>removeSupplierFromList(s)} style={{border:"none",background:"transparent",cursor:"pointer",color:"#aaa",fontSize:12,padding:"0 2px"}}>✕</button>
                    </div>
                  ))}
                </div>
              </div>
            </Card>

            {/* 엑셀 미리보기 모달 */}
            {showXlsPreview&&(
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}} onClick={()=>setShowXlsPreview(false)}>
                <div style={{background:"#fff",borderRadius:14,padding:"1.5rem",width:700,maxWidth:"95vw",maxHeight:"80vh",overflow:"auto"}} onClick={e=>e.stopPropagation()}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <p style={{fontWeight:700,fontSize:15,margin:0}}>📋 미리보기 — {xlsPreview.length}개 재료</p>
                    <button onClick={()=>setShowXlsPreview(false)} style={{border:"none",background:"#f0f0f0",borderRadius:6,cursor:"pointer",padding:"4px 10px",fontSize:16}}>✕</button>
                  </div>
                  <div style={{overflowX:"auto",marginBottom:14}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr style={{background:"#f8f8f8"}}>{["재료명","구입처","구매단위","구매무게","구매단가","등록일"].map(h=><th key={h} style={{padding:"6px 10px",fontWeight:500,color:"#666",textAlign:"left",border:"1px solid #eee"}}>{h}</th>)}</tr></thead>
                      <tbody>{xlsPreview.map((r,i)=>(
                        <tr key={i} style={{borderTop:"1px solid #f0f0f0"}}>
                          {["재료명","구입처","구매단위","구매무게","구매단가","등록일"].map(k=><td key={k} style={{padding:"6px 10px",border:"1px solid #f0f0f0"}}>{r[k]||""}</td>)}
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <Btn onClick={()=>setShowXlsPreview(false)} variant="ghost">취소</Btn>
                    <Btn onClick={()=>addIngredientsFromXls(xlsPreview)} variant="primary">✅ {xlsPreview.length}개 등록하기</Btn>
                  </div>
                </div>
              </div>
            )}

            {/* 구입처 필터 */}
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {allSupViews.map(s=>(
                <button key={s} onClick={()=>setIngViewMode(s)} style={{padding:"6px 14px",borderRadius:20,border:"1.5px solid",borderColor:ingViewMode===s?"#378ADD":"#ddd",background:ingViewMode===s?"#e8f3ff":"#fff",color:ingViewMode===s?"#1a5fa8":"#555",fontSize:13,fontWeight:500,cursor:"pointer",transition:"all 0.15s"}}>{s}</button>
              ))}
            </div>

            {/* 재료 목록 */}
            <Card>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,gap:12,flexWrap:"wrap"}}>
                <p style={{fontWeight:700,fontSize:14,margin:0,color:"#222"}}>📦 재료 목록 <span style={{fontSize:12,color:"#888",fontWeight:400}}>({filteredIngs.length}개)</span></p>
                <div style={{display:"flex",gap:8,alignItems:"center"}}>
                  {selectedIngIds.length>0&&<span style={{fontSize:12,color:"#378ADD",fontWeight:500}}>{selectedIngIds.length}개 선택</span>}
                  <input placeholder="🔍 재료명/구입처 검색" value={ingSearch} onChange={e=>setIngSearch(e.target.value)}
                    style={{padding:"7px 12px",border:"1px solid #ddd",borderRadius:20,fontSize:13,width:200,outline:"none"}}/>
                </div>
              </div>
              <div style={{overflowX:"auto"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:600}}>
                  <thead><tr style={{background:"#f8f8f8"}}>
                    <th style={{padding:"7px 10px",width:36}}>
                      <input type="checkbox" onChange={e=>{ if(e.target.checked) setSelectedIngIds(pagedIngs.map(i=>i.id)); else setSelectedIngIds([]); }} checked={pagedIngs.length>0&&pagedIngs.every(i=>selectedIngIds.includes(i.id))}/>
                    </th>
                    {["재료명","구입처","구매","단가","원/g","등록일",""].map(h=>(
                      <th key={h} style={{padding:"7px 10px",fontWeight:500,color:"#666",fontSize:12,textAlign:h==="단가"||h==="원/g"?"right":"left"}}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {pagedIngs.map(ing=>(
                      <tr key={ing.id} style={{borderTop:"1px solid #f0f0f0",background:selectedIngIds.includes(ing.id)?"#f0f7ff":"transparent"}}>
                        <td style={{padding:"8px 10px",textAlign:"center"}}>
                          <input type="checkbox" checked={selectedIngIds.includes(ing.id)} onChange={e=>setSelectedIngIds(p=>e.target.checked?[...p,ing.id]:p.filter(x=>x!==ing.id))}/>
                        </td>
                        <td style={{padding:"8px 10px",fontWeight:600}}>{ing.name}</td>
                        <td style={{padding:"8px 10px",color:"#555"}}>{ing.supplier}</td>
                        <td style={{padding:"8px 10px"}}><span style={{background:"#f0f0f0",padding:"2px 8px",borderRadius:12,fontSize:12}}>{ing.buy_weight}{ing.buy_unit}</span></td>
                        <td style={{padding:"8px 10px",textAlign:"right",fontWeight:600,color:"#1a5fa8"}}>{fmt(ing.price)}원</td>
                        <td style={{padding:"8px 10px",textAlign:"right",color:"#888",fontSize:12}}>{cpg(ing).toFixed(4)}</td>
                        <td style={{padding:"8px 10px",color:"#bbb",fontSize:12}}>{ing.date}</td>
                        <td style={{padding:"8px 10px",whiteSpace:"nowrap"}}>
                          <PriceEdit ing={ing} onSave={(p,d)=>updateIngPrice(ing.id,p,d)}/>
                          <button onClick={()=>deleteIngredient(ing.id)} style={{marginLeft:4,border:"1px solid #f7c1c1",background:"#fef0f0",color:"#E24B4A",borderRadius:6,cursor:"pointer",padding:"4px 8px",fontSize:12}}>삭제</button>
                        </td>
                      </tr>
                    ))}
                    {pagedIngs.length===0&&<tr><td colSpan={8} style={{padding:"24px",textAlign:"center",color:"#aaa",fontSize:13}}>검색 결과가 없습니다</td></tr>}
                  </tbody>
                </table>
              </div>
              {/* 페이지네이션 */}
              {totalIngPages>1&&(
                <div style={{display:"flex",justifyContent:"center",alignItems:"center",gap:6,marginTop:14}}>
                  <button onClick={()=>setIngPage(p=>Math.max(1,p-1))} disabled={ingPage===1} style={{padding:"5px 12px",border:"1px solid #ddd",borderRadius:6,cursor:ingPage===1?"default":"pointer",background:ingPage===1?"#f5f5f5":"#fff",color:ingPage===1?"#aaa":"#555",fontSize:13}}>◀</button>
                  {Array.from({length:totalIngPages},(_,i)=>i+1).map(n=>(
                    <button key={n} onClick={()=>setIngPage(n)} style={{padding:"5px 10px",border:"1px solid",borderColor:ingPage===n?"#378ADD":"#ddd",borderRadius:6,cursor:"pointer",background:ingPage===n?"#378ADD":"#fff",color:ingPage===n?"#fff":"#555",fontSize:13,fontWeight:ingPage===n?600:400}}>{n}</button>
                  ))}
                  <button onClick={()=>setIngPage(p=>Math.min(totalIngPages,p+1))} disabled={ingPage===totalIngPages} style={{padding:"5px 12px",border:"1px solid #ddd",borderRadius:6,cursor:ingPage===totalIngPages?"default":"pointer",background:ingPage===totalIngPages?"#f5f5f5":"#fff",color:ingPage===totalIngPages?"#aaa":"#555",fontSize:13}}>▶</button>
                </div>
              )}
            </Card>

            {selectedIngIds.length>0&&(
              <Card>
                <p style={{fontWeight:700,fontSize:14,margin:"0 0 4px",color:"#222"}}>📈 가격변동</p>
                <p style={{fontSize:12,color:"#aaa",margin:"0 0 14px"}}>{ingredients.filter(i=>selectedIngIds.includes(i.id)).map(i=>`${i.name}(${i.supplier})`).join(", ")}</p>
                {priceChartData.length<2?<div style={{textAlign:"center",padding:"20px",color:"#aaa",fontSize:13,background:"#f8f8f8",borderRadius:8}}>가격 이력이 2개 이상 있어야 그래프가 표시됩니다.</div>
                  :<div style={{height:240}}><ResponsiveContainer width="100%" height="100%"><LineChart data={priceChartData}><XAxis dataKey="date" tick={{fontSize:11}}/><YAxis tick={{fontSize:11}}/><Tooltip formatter={(v,n)=>[fmt(v)+"원",n]}/><Legend/>{ingredients.filter(i=>selectedIngIds.includes(i.id)).map((i,idx)=>(<Line key={i.id} type="monotone" dataKey={`${i.name}(${i.supplier})`} stroke={COLORS[idx%COLORS.length]} strokeWidth={2} dot={{r:4}} connectNulls/>))}</LineChart></ResponsiveContainer></div>}
              </Card>
            )}
          </div>
        )}

        {/* ===== 레시피 탭 ===== */}
        {tab==="레시피"&&(
          <div style={{display:"grid",gap:16}}>
            <Card>
              <p style={{fontWeight:700,fontSize:14,margin:"0 0 14px",color:"#222"}}>📋 새 레시피 등록</p>
              <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:8,marginBottom:14}}>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>레시피명</p><Inp placeholder="예: 버터쿠키" value={newRecipe.name} onChange={e=>setNewRecipe(p=>({...p,name:e.target.value}))}/></div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>1개 무게 (g)</p><Inp type="number" placeholder="예: 15" value={newRecipe.pieceWeight} onChange={e=>setNewRecipe(p=>({...p,pieceWeight:e.target.value}))}/></div>
                <div><p style={{fontSize:11,color:"#888",margin:"0 0 4px",fontWeight:500}}>판매가 (원)</p><Inp type="number" placeholder="예: 800" value={newRecipe.salePrice} onChange={e=>setNewRecipe(p=>({...p,salePrice:e.target.value}))}/></div>
              </div>

              {/* 판매단위 */}
              <div style={{background:"#f8f9fc",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                <p style={{fontSize:12,fontWeight:600,color:"#555",margin:"0 0 8px"}}>🏷️ 판매단위</p>
                <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
                  {SELL_UNITS.map(u=>(
                    <button key={u} onClick={()=>setNewRecipe(p=>({...p,sellUnitType:u}))}
                      style={{padding:"6px 16px",borderRadius:8,border:"2px solid",borderColor:newRecipe.sellUnitType===u?"#378ADD":"#ddd",background:newRecipe.sellUnitType===u?"#e8f3ff":"#fff",color:newRecipe.sellUnitType===u?"#1a5fa8":"#555",fontSize:13,fontWeight:500,cursor:"pointer"}}>
                      {u==="개"?"낱개(개)":u==="봉"?"묶음(봉)":"무게(kg)"}
                    </button>
                  ))}
                  <div style={{display:"flex",alignItems:"center",gap:6,marginLeft:8}}>
                    <input type="number" value={newRecipe.sellUnitQty} onChange={e=>setNewRecipe(p=>({...p,sellUnitQty:e.target.value}))}
                      style={{width:70,padding:"7px 10px",border:"1px solid #ddd",borderRadius:8,fontSize:13,textAlign:"center"}}/>
                    <span style={{fontSize:13,color:"#555",fontWeight:500}}>
                      {newRecipe.sellUnitType==="개"?"개":newRecipe.sellUnitType==="봉"?`개 × 1봉`:"kg"}
                    </span>
                  </div>
                </div>
                <p style={{fontSize:12,color:"#888",margin:"8px 0 0"}}>
                  판매단위: <strong style={{color:"#1a5fa8"}}>{buildSellUnit(newRecipe.sellUnitQty,newRecipe.sellUnitType)}</strong>
                </p>
              </div>

              <p style={{fontSize:13,fontWeight:600,color:"#555",margin:"0 0 8px"}}>재료 / 레시피 추가</p>
              <div style={{display:"flex",gap:8,marginBottom:10}}>
                {["ingredient","recipe"].map(t=>(
                  <button key={t} onClick={()=>setAddItem(p=>({...p,type:t,ingId:null,ingName:"",recipeId:"",amount:""}))}
                    style={{padding:"7px 18px",borderRadius:8,border:"2px solid",borderColor:addItem.type===t?"#378ADD":"#ddd",background:addItem.type===t?"#e8f3ff":"#fff",color:addItem.type===t?"#1a5fa8":"#666",fontSize:13,fontWeight:500,cursor:"pointer"}}>
                    {t==="ingredient"?"🥕 재료":"📋 레시피"}
                  </button>
                ))}
              </div>
              {addItem.type==="ingredient"?(
                <div style={{display:"grid",gap:8,marginBottom:10}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <IngSearch ingredients={ingredients} value={addItem.ingId} onChange={(id,name)=>setAddItem(p=>({...p,ingId:id,ingName:name}))}/>
                    <Inp type="number" placeholder="사용량 (g)" value={addItem.amount} onChange={e=>setAddItem(p=>({...p,amount:e.target.value}))} style={{width:140}}/>
                    <Btn onClick={addItemToRecipe} variant="primary" style={{whiteSpace:"nowrap"}}>➕ 추가</Btn>
                  </div>
                  {sameNameIngs.length>0&&(
                    <div style={{background:"#f8f9fc",borderRadius:8,padding:"10px 14px"}}>
                      <p style={{fontSize:12,color:"#555",fontWeight:600,margin:"0 0 8px"}}>🏪 구입처 선택</p>
                      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                        {sameNameIngs.map(i=>(
                          <button key={i.id} onClick={()=>setAddItem(p=>({...p,ingId:i.id}))}
                            style={{padding:"7px 14px",borderRadius:8,border:"2px solid",borderColor:addItem.ingId===i.id?"#378ADD":"#ddd",background:addItem.ingId===i.id?"#e8f3ff":"#fff",color:addItem.ingId===i.id?"#1a5fa8":"#555",fontSize:13,fontWeight:500,cursor:"pointer"}}>
                            <span style={{fontWeight:600}}>{i.supplier}</span>
                            <span style={{marginLeft:8,fontSize:12,color:addItem.ingId===i.id?"#378ADD":"#888"}}>{fmt(i.price)}원/{i.buy_weight}{i.buy_unit} · {cpg(i).toFixed(4)}원/g</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ):(
                <div style={{display:"flex",gap:8,marginBottom:10}}>
                  <Sel value={addItem.recipeId} onChange={e=>setAddItem(p=>({...p,recipeId:e.target.value}))}>
                    <option value="">레시피 선택</option>
                    {recipes.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
                  </Sel>
                  <Inp type="number" placeholder="사용량 (g)" value={addItem.amount} onChange={e=>setAddItem(p=>({...p,amount:e.target.value}))} style={{width:160}}/>
                  <Btn onClick={addItemToRecipe} variant="primary" style={{whiteSpace:"nowrap"}}>➕ 추가</Btn>
                </div>
              )}
              {newRecipe.items.length>0&&(
                <div style={{background:"#f8f9fc",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                  <p style={{fontSize:12,fontWeight:600,color:"#555",margin:"0 0 8px"}}>추가된 재료</p>
                  {newRecipe.items.map((item,idx)=>{
                    let label,sub;
                    if(item.type==="ingredient"){ const ing=ingredients.find(i=>i.id===item.id); label=ing?.name||"?"; sub=ing?.supplier||""; }
                    else { const rec=recipes.find(r=>r.id===item.id); label=rec?.name||"?"; sub="레시피"; }
                    return(
                      <div key={idx} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:idx<newRecipe.items.length-1?"1px solid #eee":"none"}}>
                        <span style={{width:10,height:10,borderRadius:2,background:COLORS[idx%COLORS.length],flexShrink:0,display:"inline-block"}}/>
                        <span style={{flex:1,fontSize:13,fontWeight:500}}>{label}</span>
                        <span style={{fontSize:12,color:"#888"}}>{sub}</span>
                        <span style={{fontSize:13,fontWeight:600,color:"#1a5fa8",minWidth:60,textAlign:"right"}}>{item.amount}g</span>
                        <button onClick={()=>setNewRecipe(p=>({...p,items:p.items.filter((_,i)=>i!==idx)}))} style={{border:"none",background:"#fee",color:"#e24b4a",borderRadius:4,cursor:"pointer",padding:"3px 8px",fontSize:12}}>✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
              <p style={{fontSize:13,fontWeight:600,color:"#555",margin:"0 0 8px"}}>제조방법</p>
              <div style={{display:"flex",gap:8,marginBottom:8}}>
                <Inp placeholder="단계 입력 후 Enter 또는 추가 버튼" value={newStep} onChange={e=>setNewStep(e.target.value)} style={{flex:1}}
                  onKeyDown={e=>{ if(e.key==="Enter"&&newStep.trim()){setNewRecipe(p=>({...p,steps:[...p.steps,newStep.trim()]}));setNewStep("");}}}/>
                <Btn onClick={()=>{if(newStep.trim()){setNewRecipe(p=>({...p,steps:[...p.steps,newStep.trim()]}));setNewStep("");}}} variant="primary">추가</Btn>
              </div>
              {newRecipe.steps.length>0&&(
                <div style={{background:"#fffdf5",border:"1px solid #faeeda",borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                  {newRecipe.steps.map((step,idx)=>(
                    <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"6px 0",borderBottom:idx<newRecipe.steps.length-1?"1px solid #f5ead0":"none"}}>
                      <span style={{minWidth:22,height:22,background:"#BA7517",color:"#fff",borderRadius:"50%",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{idx+1}</span>
                      <span style={{flex:1,fontSize:13,lineHeight:1.5}}>{step}</span>
                      <button onClick={()=>setNewRecipe(p=>({...p,steps:p.steps.filter((_,i)=>i!==idx)}))} style={{border:"none",background:"#fee",color:"#e24b4a",borderRadius:4,cursor:"pointer",padding:"2px 7px",fontSize:12}}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <Btn onClick={saveRecipe} variant="primary" style={{padding:"10px 28px"}}>💾 레시피 저장</Btn>
            </Card>

            {recipes.map(r=>{
              const {pieceCost,sellUnitCost,margin,pieceCount,res}=calcSellUnitCost(r,ingredients,recipes);
              const showRatio=recipeView[r.id]?.ratio, showCost=recipeView[r.id]?.cost, showSteps=recipeView[r.id]?.steps;
              return(
                <Card key={r.id}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                    <span style={{fontWeight:700,fontSize:16,color:"#111"}}>{r.name}</span>
                    <Btn onClick={()=>deleteRecipe(r.id)} variant="danger" style={{fontSize:12,padding:"5px 12px"}}>삭제</Btn>
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:8}}>
                    {[["총 무게",`${fmt(res?.totalWeight)}g`],["총 원가",`${fmt(res?.total)}원`],[`1개(${r.pieceWeight}g) 원가`,`${fmtD(pieceCost)}원`]].map(([l,v])=>(
                      <div key={l} style={{background:"#f5f9ff",borderRadius:8,padding:"10px 12px",border:"1px solid #ddeeff"}}>
                        <p style={{fontSize:11,color:"#7aabdd",margin:"0 0 3px",fontWeight:500}}>{l}</p>
                        <p style={{fontSize:16,fontWeight:700,margin:0,color:"#1a5fa8"}}>{v}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:14}}>
                    {[["판매단위",r.sellUnit||"-",false],["판매단위 원가",`${fmtD(sellUnitCost)}원`,false],["판매가",`${fmt(r.salePrice)}원`,false],["마진율",`${fmtD(margin)}%`,true]].map(([l,v,c])=>(
                      <div key={l} style={{background:c?mgBg(margin):"#f8f8f8",borderRadius:8,padding:"10px 12px",border:`1px solid ${c?mgColor(margin)+"44":"#eee"}`}}>
                        <p style={{fontSize:11,color:c?mgColor(margin):"#999",margin:"0 0 3px",fontWeight:500}}>{l}</p>
                        <p style={{fontSize:15,fontWeight:700,margin:0,color:c?mgColor(margin):"#333"}}>{v}</p>
                      </div>
                    ))}
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    {[["ratio","재료 비율(%)","#378ADD","#e8f3ff"],["cost","재료별 원가","#1D9E75","#eaf3de"],["steps","제조방법","#BA7517","#faeeda"]].map(([key,label,color,bg])=>{
                      const on=recipeView[r.id]?.[key];
                      return(<button key={key} onClick={()=>toggleView(r.id,key)} style={{padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500,border:"2px solid",borderColor:on?color:"#ddd",background:on?bg:"#fff",color:on?color:"#666",transition:"all 0.15s"}}>{on?"▲":"▼"} {label}</button>);
                    })}
                  </div>
                  {(showRatio||showCost)&&(
                    <div style={{marginTop:12,borderTop:"1px solid #eee",paddingTop:12}}>
                      <table style={{width:"100%",fontSize:13,borderCollapse:"collapse"}}>
                        <thead><tr style={{background:"#f8f8f8"}}>{["","재료","사용량(g)",...(showRatio?["무게비율(%)"]:[]),...(showCost?["원가(원)","원가비율(%)"]:[])].map(h=><th key={h} style={{padding:"7px 10px",fontWeight:500,color:"#666",fontSize:12,textAlign:h===""||h==="재료"?"left":"right"}}>{h}</th>)}</tr></thead>
                        <tbody>{(res?.items||[]).map((item,idx)=>(
                          <tr key={idx} style={{borderTop:"1px solid #f0f0f0"}}>
                            <td style={{padding:"7px 10px"}}><span style={{display:"inline-block",width:10,height:10,borderRadius:2,background:COLORS[idx%COLORS.length]}}/></td>
                            <td style={{padding:"7px 10px",fontWeight:500}}>{item.name}{item.isRecipe&&<span style={{fontSize:11,background:"#e8f3ff",color:"#378ADD",padding:"1px 6px",borderRadius:10,marginLeft:4}}>레시피</span>}</td>
                            <td style={{padding:"7px 10px",textAlign:"right"}}>{item.amount}</td>
                            {showRatio&&<td style={{padding:"7px 10px",textAlign:"right",color:"#378ADD",fontWeight:500}}>{fmtD(item.weightRatio)}%</td>}
                            {showCost&&<td style={{padding:"7px 10px",textAlign:"right"}}>{fmtD(item.cost)}</td>}
                            {showCost&&<td style={{padding:"7px 10px",textAlign:"right",color:"#1D9E75",fontWeight:500}}>{fmtD(item.costRatio)}%</td>}
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  {showSteps&&r.steps&&r.steps.length>0&&(
                    <div style={{marginTop:12,borderTop:"1px solid #eee",paddingTop:12}}>
                      <div style={{background:"#fffdf5",border:"1px solid #faeeda",borderRadius:10,padding:"12px 16px"}}>
                        {r.steps.map((step,idx)=>(
                          <div key={idx} style={{display:"flex",alignItems:"flex-start",gap:12,padding:"8px 0",borderBottom:idx<r.steps.length-1?"1px solid #f5ead0":"none"}}>
                            <span style={{minWidth:24,height:24,background:"#BA7517",color:"#fff",borderRadius:"50%",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>{idx+1}</span>
                            <span style={{fontSize:13,lineHeight:1.6,color:"#444"}}>{step}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}

        {/* ===== 분석 탭 ===== */}
        {tab==="분석"&&(
          <div style={{display:"grid",gap:16}}>
            <Card>
              <p style={{fontWeight:700,fontSize:14,margin:"0 0 10px",color:"#222"}}>🔍 레시피 검색</p>
              <Inp placeholder="제품명 또는 재료명으로 검색" value={searchQ} onChange={e=>setSearchQ(e.target.value)}/>
              {searchQ&&<p style={{fontSize:12,color:"#888",margin:"8px 0 0"}}>검색 결과: {filteredRecipes.length}개</p>}
            </Card>
            <Card>
              <p style={{fontWeight:700,fontSize:14,margin:"0 0 6px",color:"#222"}}>📊 레시피별 원가 vs 판매가</p>
              <div style={{height:Math.max(200,filteredRecipes.length*55+80)}}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredRecipes.map(r=>{ const {sellUnitCost}=calcSellUnitCost(r,ingredients,recipes); return{name:r.name,판매단위원가:parseFloat(sellUnitCost.toFixed(1)),판매가:r.salePrice}; })} layout="vertical">
                    <XAxis type="number" tick={{fontSize:11}}/><YAxis type="category" dataKey="name" tick={{fontSize:12}} width={90}/>
                    <Tooltip formatter={v=>[fmt(v)+"원"]}/><Legend/>
                    <Bar dataKey="판매단위원가" fill="#378ADD" radius={[0,4,4,0]}/><Bar dataKey="판매가" fill="#1D9E75" radius={[0,4,4,0]}/>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <div>
              <p style={{fontWeight:700,fontSize:14,margin:"0 0 10px",color:"#222"}}>💹 마진율 현황</p>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:10}}>
                {filteredRecipes.map(r=>{ const {sellUnitCost,margin}=calcSellUnitCost(r,ingredients,recipes); return(
                  <div key={r.id} style={{background:mgBg(margin),border:`1px solid ${mgColor(margin)}44`,borderRadius:10,padding:"14px",textAlign:"center"}}>
                    <p style={{fontSize:12,color:mgColor(margin),margin:"0 0 2px",fontWeight:600}}>{r.name}</p>
                    <p style={{fontSize:11,color:"#aaa",margin:"0 0 4px"}}>{r.sellUnit||"-"}</p>
                    <p style={{fontSize:26,fontWeight:700,color:mgColor(margin),margin:"0 0 4px"}}>{fmtD(margin)}%</p>
                    <p style={{fontSize:11,color:"#888",margin:0}}>단위원가 {fmtD(sellUnitCost)}원</p>
                  </div>
                ); })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
