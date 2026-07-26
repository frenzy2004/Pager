export function MochiFace({ small = false }: { small?: boolean }) {
  return (
    <span className={`mochi-face${small ? " mochi-face--small" : ""}`}>
      <span className="mochi-ear mochi-ear--left" />
      <span className="mochi-ear mochi-ear--right" />
      <span className="mochi-cheek mochi-cheek--left" />
      <span className="mochi-cheek mochi-cheek--right" />
      <span className="mochi-eye mochi-eye--left" />
      <span className="mochi-eye mochi-eye--right" />
      <span className="mochi-mouth" />
      <span className="mochi-spark" aria-hidden="true">
        ✦
      </span>
    </span>
  );
}

