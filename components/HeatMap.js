'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
const UF = { 11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF' };
const SIGLAS = new Set(Object.values(UF));
const SEQ = ['#26305a', '#3b5a9e', '#2f9fb3', '#2dd4bf'];            // pouco -> muito (uma família de cor)
const DIV = ['#f0716f', '#a85d72', '#3b4470', '#2dd4bf'];             // caiu -> subiu (vermelho/verde só aqui, onde significa algo)
const API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
const fmt = n => Number(n).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
const normalize = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const cleanKey = s => normalize(s).replace(/[^a-z0-9]/g, '');

function matchValueByFeature(feature, data, geo) {
  const code = String(feature?.properties?.codarea ?? feature?.properties?.id ?? '').replace(/\D/g, '');
  const state = feature?.properties?.uf ?? feature?.properties?.nome;
  const name = normalize(feature?.properties?.nome || '');
  const byCode = data.find(d => cleanKey(d.k) === cleanKey(code));
  if (byCode) return byCode.v;
  const exactName = data.find(d => cleanKey(d.k) === cleanKey(name) || cleanKey(d.k) === cleanKey(state));
  if (exactName) return exactName.v;
  if (geo === 'municipio') {
    const words = name.split(' ').filter(Boolean);
    const compact = words.slice(0, Math.max(1, words.length - 1)).join(' ');
    const fallback = data.find(d => cleanKey(d.k) === cleanKey(compact));
    if (fallback) return fallback.v;
  }
  return null;
}

// Diz se a dimensão é geográfica: siglas de UF (SP, MG...), nome de município ou códigos IBGE de 7 dígitos.
export function detectGeo(data) {
  const keys = data.map(d => String(d.k).trim()).filter(Boolean);
  if (!keys.length) return null;
  const normalized = keys.map(normalize);
  const muniCode = keys.filter(k => /^\d{7}$/.test(String(k).trim())).length;
  const ufLike = keys.filter(k => SIGLAS.has(String(k).trim().toUpperCase()) || /^(sao paulo|rio grande do sul|minas gerais|bahia|pernambuco|ceara|rio de janeiro|parana|santa catarina|goias|maranhao|piaui|paraiba|alagoas|sergipe|rio grande do norte|espírito santo|mato grosso|mato grosso do sul|amazonas|acre|rondonia|roraima|tocantins|para|amapa|distrito federal)$/i.test(String(k).trim())).length;
  const muniName = keys.filter(k => /^(?:[a-zà-úç]+(?:\s+[a-zà-úç]+)*)$/i.test(k) && !/^\d{2}$/.test(k) && k.split(/\s+/).length >= 2).length;
  if (muniCode / keys.length >= .9) return 'municipio';
  if (ufLike / keys.length >= .6) return 'uf';
  if (muniName / keys.length >= .7) return 'municipio';
  return null;
}

export default function HeatMap({ data, diverging = false }) {
  const el = useRef();
  const geo = useMemo(() => detectGeo(data), [data]);
  const [state, setState] = useState('loading');
  const vs = data.map(d => d.v).filter(Number.isFinite);
  const min = vs.length ? Math.min(...vs) : 0;
  const max = vs.length ? Math.max(...vs) : 0;
  const ramp = diverging ? DIV : SEQ;

  useEffect(() => {
    if (!geo) return;
    let map, dead = false; setState('loading');
    (async () => {
      try {
        const L = (await import('leaflet')).default;
        const keys = data.map(d => String(d.k).trim());
        const muni = geo === 'municipio';
        const ufSet = new Set(keys.map(k => String(k).trim().slice(0, 2).toUpperCase()));
        const url = muni ? (ufSet.size === 1 && [...ufSet][0].length === 2 ? `${API}/estados/${[...ufSet][0]}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`
          : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`)
          : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF`;
        const res = await fetch(url); if (!res.ok) throw new Error(res.status);
        const gj = await res.json(); if (dead) return;
        const getValue = feature => {
          const code = String(feature?.properties?.codarea ?? feature?.properties?.id ?? '').replace(/\D/g, '');
          if (muni) {
            const byCode = data.find(d => cleanKey(String(d.k)) === cleanKey(code));
            if (byCode) return byCode.v;
            return matchValueByFeature(feature, data, geo);
          }
          const ufCode = feature?.properties?.codarea;
          const ufKey = UF[ufCode] || feature?.properties?.nome || String(feature?.properties?.codarea ?? '');
          const byUf = data.find(d => cleanKey(String(d.k)) === cleanKey(ufKey) || cleanKey(String(d.k)) === cleanKey(String(ufCode)));
          return byUf ? byUf.v : null;
        };
        const color = v => {
          if (v == null) return '#1b2040';
          if (diverging) return v === 0 ? ramp[2] : v > 0 ? ramp[3] : ramp[0];
          if (max === min) return ramp[0];
          return ramp[Math.min(3, Math.floor((v - min) / ((max - min) || 1) * 4))];
        };
        map = L.map(el.current, { attributionControl: false });
        const layer = L.geoJSON(gj, {
          style: f => ({ fillColor: color(getValue(f)), fillOpacity: .95, color: '#0d1020', weight: .6 }),
          onEachFeature: (f, l) => {
            const v = getValue(f);
            const label = muni ? (f.properties?.nome || f.properties?.codarea) : (UF[f.properties?.codarea] || f.properties?.nome || f.properties?.codarea);
            l.bindTooltip(`${label}: ${v == null ? 'sem dados' : (diverging && v > 0 ? '+' : '') + fmt(v)}`);
          }
        }).addTo(map);
        map.fitBounds(layer.getBounds()); setState('ok');
      } catch (e) { if (!dead) setState('error'); }
    })();
    return () => { dead = true; map?.remove(); };
  }, [data, geo, diverging, min, max]);

  if (!geo) return <p className="empty-state">Este agrupamento não parece geográfico, então não há o que mapear. O mapa funciona com siglas de estado (SP, MG, BA...), nomes de município ou códigos IBGE de município com 7 dígitos.</p>;
  return <div>
    {state === 'error' && <p className="status-message" role="alert">Não consegui carregar o mapa do IBGE agora. Verifique a conexão e tente de novo; os números continuam na tabela acima.</p>}
    <div ref={el} className="heatmap" aria-label="Mapa de calor" />
    <div className="legend" aria-hidden="true"><span>{diverging ? 'queda' : fmt(min)}</span>
      <span className="ramp" style={{ background: `linear-gradient(90deg, ${ramp.join(', ')})` }}/>
      <span>{diverging ? 'alta' : fmt(max)}</span></div>
  </div>;
}
