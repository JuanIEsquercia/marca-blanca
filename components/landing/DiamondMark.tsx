// Recrea el diamante del logo (public/logo.png) como SVG — mitad marfil,
// mitad oro, mismos tonos exactos que el resto de la landing.
export default function DiamondMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} aria-hidden="true">
      <polygon points="50,8 8,50 50,92" fill="var(--ivory)" />
      <polygon points="50,8 92,50 50,92" fill="var(--gold)" />
    </svg>
  )
}
