import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Study Media · A little scroll. A lot of learning.',description:'Short lessons, voice explanations and a space to learn together.'};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
