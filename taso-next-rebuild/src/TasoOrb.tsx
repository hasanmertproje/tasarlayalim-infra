import React from 'react';
/** Branded TASO sphere. Pure SVG: no network or external assets. */
export default function TasoOrb({size=148,className='',decorative=true}:{size?:number;className?:string;decorative?:boolean}) {
 return <svg className={'taso-orb '+className} width={size} height={size} viewBox="0 0 220 220" fill="none" xmlns="http://www.w3.org/2000/svg" role={decorative?'presentation':'img'} aria-hidden={decorative?'true':undefined} aria-label={decorative?undefined:'TASO yapay zekâ küresi'}>
 <defs>
 <radialGradient id="taso-orb-core" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(66 48) rotate(49) scale(222 211)"><stop stopColor="#B5B9FF"/><stop offset=".15" stopColor="#729AFF"/><stop offset=".4" stopColor="#6045F4"/><stop offset=".7" stopColor="#C448E8"/><stop offset=".87" stopColor="#5F35D6"/><stop offset="1" stopColor="#110E48"/></radialGradient>
 <radialGradient id="taso-orb-pink" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(160 126) rotate(172) scale(98 78)"><stop stopColor="#F357E8" stopOpacity=".93"/><stop offset="1" stopColor="#F357E8" stopOpacity="0"/></radialGradient>
 <linearGradient id="taso-orb-rim" x1="33" y1="33" x2="188" y2="190"><stop stopColor="#6DE2FF"/><stop offset=".52" stopColor="#A58CFF"/><stop offset=".9" stopColor="#D66BFF"/></linearGradient>
 <linearGradient id="taso-orb-arc" x1="53" y1="133" x2="165" y2="66"><stop stopColor="#55DAFF"/><stop offset=".51" stopColor="#CFB2FF"/><stop offset="1" stopColor="#F368EC"/></linearGradient>
 <filter id="taso-orb-shadow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="8"/></filter><clipPath id="taso-orb-clip"><circle cx="110" cy="110" r="87"/></clipPath>
 </defs>
 <circle cx="110" cy="110" r="93" fill="#623DFF" opacity=".45" filter="url(#taso-orb-shadow)"/>
 <circle cx="110" cy="110" r="88" fill="url(#taso-orb-core)" stroke="url(#taso-orb-rim)" strokeWidth="1.8"/>
 <g clipPath="url(#taso-orb-clip)"><circle cx="120" cy="121" r="83" fill="url(#taso-orb-pink)"/>
 <path d="M40 124C66 75 107 63 154 65C170 66 180 77 184 91" stroke="url(#taso-orb-arc)" strokeWidth="2.4" strokeLinecap="round"/>
 <path d="M53 132C93 89 135 90 180 117" stroke="#B0A7FF" strokeOpacity=".85" strokeWidth="1.9" strokeLinecap="round"/>
 <path d="M53 124C90 155 128 167 176 146" stroke="#B4A0FF" strokeOpacity=".75" strokeWidth="1.75" strokeLinecap="round"/>
 <path d="M178 131C158 166 120 185 89 177C69 171 62 154 61 146" stroke="url(#taso-orb-arc)" strokeWidth="2.2" strokeLinecap="round"/>
 <path d="M137 61C153 57 172 70 174 85" stroke="#F48AEC" strokeWidth="2" strokeLinecap="round"/><path d="M81 184C102 194 128 184 140 178" stroke="#EA7DF7" strokeWidth="1.8" strokeLinecap="round"/>
 <ellipse cx="72" cy="55" rx="57" ry="27" transform="rotate(-23 72 55)" fill="#B8DDFF" opacity=".12"/></g>
 <circle cx="110" cy="110" r="88" stroke="#78A2FF" strokeWidth="1" strokeOpacity=".6"/></svg>;
}
