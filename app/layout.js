import './globals.css';
import { Manrope } from 'next/font/google';
const f = Manrope({ subsets: ['latin'] });
export const metadata = { title: 'Painel', description: 'Dashboards a partir das suas planilhas' };
export default function L({ children }) { return <html lang="pt-BR"><body className={f.className}>{children}</body></html>; }
