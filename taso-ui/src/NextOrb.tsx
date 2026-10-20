type NextOrbProps = {size?:'small'|'medium'|'large';active?:boolean;className?:string};
export default function NextOrb({size='medium',active=false,className=''}:NextOrbProps){
  return <span className={['taso-next-orb','taso-next-orb--'+size,active?'taso-next-orb--active':'',className].filter(Boolean).join(' ')} aria-hidden="true">
    <span className="taso-next-orb__inner"/><span className="taso-next-orb__orbit taso-next-orb__orbit--a"/><span className="taso-next-orb__orbit taso-next-orb__orbit--b"/><span className="taso-next-orb__flare"/>
  </span>;
}
