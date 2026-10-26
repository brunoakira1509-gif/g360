'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
const UF = { 11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF' };
const SIGLAS = new Set(Object.values(UF));
const SEQ = ['#26305a', '#3b5a9e', '#2f9fb3', '#2dd4bf'];            // pouco -> muito (uma família de cor)
const DIV = ['#f0716f', '#a85d72', '#3b4470', '#2dd4bf'];             // caiu -> subiu (vermelho/verde só aqui, onde significa algo)
const API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const fmt = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

// Diz se a dimensão é geográfica: siglas de UF (SP, MG...) ou códigos IBGE de 7 dígitos.
export function detectGeo(data) {
  const keys = data.map(d => String(d.k).trim().toUpperCase()).filter(Boolean);
  if (!keys.length) return null;
  const muni = keys.filter(k => /^\d{7}$/.test(k)).length, uf = keys.filter(k => SIGLAS.has(k)).length;
  if (muni / keys.length >= .9) return 'municipio';
  if (uf / keys.length >= .6) return 'uf';
  return null;
}

export default function HeatMap({ data, diverging = false }) {
  const el = useRef();
  const geo = useMemo(() => detectGeo(data), [data]);
  const [state, setState] = useState('loading');
  const vs = data.map(d => d.v).filter(Number.isFinite), min = Math.min(...vs), max = Math.max(...vs);
  const ramp = diverging ? DIV : SEQ;

  useEffect(() => {
    if (!geo) return;
    let map, dead = false; setState('loading');
    (async () => {
      try {
        const L = (await import('leaflet')).default;
        const keys = data.map(d => String(d.k).trim().toUpperCase());
        const muni = geo === 'municipio', ufs = new Set(keys.map(k => k.slice(0, 2)));
        const url = muni ? (ufs.size === 1 ? `${API}/estados/${[...ufs][0]}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`
          : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`)
          : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF`;
        const res = await fetch(url); if (!res.ok) throw new Error(res.status);
        const gj = await res.json(); if (dead) return;
        const val = new Map(data.map(d => [String(d.k).trim().toUpperCase(), d.v]));
        const id = f => muni ? f.properties.codarea : UF[f.properties.codarea];
        // divergente: o zero é o centro (verde acima, vermelho abaixo); sequencial: do menor ao maior
        const lim = Math.max(Math.abs(min), Math.abs(max)) || 1;
        const color = v => {
          if (v == null) return '#1b2040';
          if (diverging) return v === 0 ? ramp[2] : v > 0 ? ramp[3] : ramp[0];
          return ramp[Math.min(3, Math.floor((v - min) / ((max - min) || 1) * 4))];
        };
        map = L.map(el.current, { attributionControl: false });
        const layer = L.geoJSON(gj, {
          style: f => ({ fillColor: color(val.get(id(f))), fillOpacity: .95, color: '#0d1020', weight: .6 }),
          onEachFeature: (f, l) => { const v = val.get(id(f)); l.bindTooltip(`${id(f)}: ${v == null ? 'sem dados' : (diverging && v > 0 ? '+' : '') + fmt(v)}`); } }).addTo(map);
        map.fitBounds(layer.getBounds()); setState('ok');
      } catch (e) { if (!dead) setState('error'); }
    })();
    return () => { dead = true; map?.remove(); };
  }, [data, geo, diverging]);

  if (!geo) return <p className="empty-state">Este agrupamento não parece geográfico, então não há o que mapear. O mapa funciona quando a coluna traz siglas de estado (SP, MG, BA...) ou códigos IBGE de município com 7 dígitos.</p>;
  return <div>
    {state === 'error' && <p className="status-message" role="alert">Não consegui carregar o mapa do IBGE agora. Verifique a conexão e tente de novo; os números continuam na tabela acima.</p>}
    <div ref={el} className="heatmap" aria-label="Mapa de calor" />
    <div className="legend" aria-hidden="true"><span>{diverging ? 'queda' : fmt(min)}</span>
      <span className="ramp" style={{ background: `linear-gradient(90deg, ${ramp.join(', ')})` }}/>
      <span>{diverging ? 'alta' : fmt(max)}</span></div>
  </div>;
}
