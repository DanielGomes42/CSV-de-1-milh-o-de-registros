import React, {useEffect, useState} from 'react';
import {createRoot} from 'react-dom/client';
import './style.css';

const api = (path, options) => fetch(`/api${path}`, options).then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)));
const money = new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'});

function App() {
  const [job, setJob] = useState(null), [rows, setRows] = useState([]), [cursors, setCursors] = useState([null]), [cursorIndex, setCursorIndex] = useState(0), [nextCursor, setNextCursor] = useState(''), [agg, setAgg] = useState([]), [capacity, setCapacity] = useState(null), [error, setError] = useState('');
  const load = () => { api(`/transactions?size=30${cursors[cursorIndex] ? `&cursor=${cursors[cursorIndex]}` : ''}`).then(d => {setRows(d.items); setNextCursor(d.nextCursor)}).catch(setError); api('/aggregates').then(setAgg).catch(setError); api('/capacity').then(setCapacity).catch(setError); };
  useEffect(load, [cursorIndex]);
  useEffect(() => {
    if (!job) return;
    if (job.status === 'COMPLETED') { load(); return; }
    if (!['QUEUED','PUBLISHING','CONSUMING'].includes(job.status)) return;
    const timer = setTimeout(() => api(`/imports/${job.id}`).then(setJob).catch(setError), 1000);
    return () => clearTimeout(timer);
  }, [job]);
  async function upload(e) {
    const file = e.target.files?.[0]; if (!file) return;
    setError(''); const form = new FormData(); form.append('file', file);
    try { setJob({...await api('/imports', {method:'POST', body:form}), status:'QUEUED', read:0, published:0, persisted:0, errors:0}); } catch (x) { setError(String(x)); }
  }
  const max = Math.max(...agg.map(x => Number(x.total)), 1), currentTotal = agg.reduce((n,x) => n + Number(x.total), 0), total = agg.reduce((n,x) => n + Number(x.count), 0);
  return <main>
    <header><div><p className="eyebrow">GEOSAPIENS</p><h1>Central de dados</h1></div><label className="upload">Importar CSV<input type="file" accept=".csv,text/csv" onChange={upload}/></label></header>
    {error && <p className="error">{error}</p>}
    {job && <section className={`job ${job.status.toLowerCase()}`}><strong>{job.status}</strong> - {job.read.toLocaleString()} lidas, {job.published.toLocaleString()} no Kafka, {job.persisted.toLocaleString()} persistidas, {job.errors} inválidas {job.message && `(${job.message})`}</section>}
    <section className="cards"><article><span>Total processado</span><b>{total.toLocaleString()}</b></article><article><span>Valor agregado</span><b>{money.format(currentTotal)}</b></article><article><span>Grupos mês/categoria</span><b>{agg.length}</b></article><article className={capacity?.state?.toLowerCase()}><span>Uso estimado do banco</span><b>{capacity ? `${capacity.usedPercent.toFixed(2)}%` : '...'}</b><small>{capacity?.state || 'Carregando'}</small></article><article><span>Registros estimados restantes</span><b>{capacity ? Number(capacity.estimatedAdditionalRecords).toLocaleString() : '...'}</b><small>Limite configurado</small></article></section>
    <section className="panel"><h2>Agregação por mês e categoria</h2><div className="bars">{agg.slice(0, 8).map(x => <div className="bar" key={`${x.month}${x.category}`}><label>{x.month} · {x.category}<small>{money.format(x.total)} ({x.count})</small></label><i style={{width:`${Number(x.total)/max*100}%`}} /></div>)}{!agg.length && <p>Importe um CSV para visualizar os indicadores.</p>}</div></section>
    <section className="panel"><div className="title"><h2>Transações</h2><span>{total.toLocaleString()} registros</span></div><div className="table"><table><thead><tr><th>Data</th><th>Categoria</th><th>Valor</th><th>Origem</th></tr></thead><tbody>{rows.map(r => <tr key={r.id}><td>{new Date(r.occurred_at).toLocaleString('pt-BR')}</td><td>{r.category}</td><td>{money.format(r.amount)}</td><td>{r.source}</td></tr>)}</tbody></table>{!rows.length && <p>Nenhum registro encontrado.</p>}</div><nav><button disabled={!cursorIndex} onClick={()=>setCursorIndex(cursorIndex-1)}>Anterior</button><span>Lote {cursorIndex+1}</span><button disabled={!nextCursor} onClick={()=>{setCursors([...cursors, nextCursor]); setCursorIndex(cursorIndex+1)}}>Próxima</button></nav></section>
  </main>;
}
createRoot(document.getElementById('root')).render(<App/>);
