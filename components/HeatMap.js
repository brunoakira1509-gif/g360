'use client';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
const UF = { 11:'RO',12:'AC',13:'AM',14:'RR',15:'PA',16:'AP',17:'TO',21:'MA',22:'PI',23:'CE',24:'RN',25:'PB',26:'PE',27:'AL',28:'SE',29:'BA',31:'MG',32:'ES',33:'RJ',35:'SP',41:'PR',42:'SC',43:'RS',50:'MS',51:'MT',52:'GO',53:'DF' };
const RAMP = ['#2b3a67', '#7c6cff', '#f472b6', '#f59e0b'];
const API = 'https://servicodados.ibge.gov.br/api/v3/malhas';
// Dimensão com sigla de UF (SP, MG...) => mapa por estado. Códigos IBGE de 7 dígitos => mapa por município.
export default function HeatMap({ data }) {
  const el = useRef();
  useEffect(() => {
    let map, dead = false;
    (async () => {
      const L = (await import('leaflet')).default;
      const keys = data.map(d => String(d.k).trim().toUpperCase());
      const muni = keys.length > 0 && keys.every(k => /^\d{7}$/.test(k));
      const ufs = new Set(keys.map(k => k.slice(0, 2)));
      const url = muni ? (ufs.size === 1 ? `${API}/estados/${[...ufs][0]}?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`
        : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=municipio`)
        : `${API}/paises/BR?formato=application/vnd.geo+json&qualidade=minima&intrarregiao=UF`;
      const gj = await (await fetch(url)).json(); if (dead) return;
      const val = new Map(data.map(d => [String(d.k).trim().toUpperCase(), d.v]));
      const id = f => muni ? f.properties.codarea : UF[f.properties.codarea];
      const vs = data.map(d => d.v), min = Math.min(...vs), max = Math.max(...vs);
      map = L.map(el.current, { attributionControl: false });
      const layer = L.geoJSON(gj, {
        style: f => { const v = val.get(id(f)); return { fillColor: v == null ? '#1f2442' : RAMP[Math.min(3, Math.floor((v - min) / ((max - min) || 1) * 4))], fillOpacity: .92, color: '#0d1020', weight: .6 }; },
        onEachFeature: (f, l) => { const v = val.get(id(f)); l.bindTooltip(`${id(f)}: ${v == null ? 'sem dados' : v.toLocaleString('pt-BR')}`); } }).addTo(map);
      map.fitBounds(layer.getBounds());
    })();
    return () => { dead = true; map?.remove(); };
  }, [data]);
  return <div ref={el} style={{ height: 420, borderRadius: 10, background: '#0d1020' }} />;
}
