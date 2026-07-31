/**
 * Marca ZAPmoon. O "A" é o símbolo (seta/agulha roxa apontando para cima com a
 * ponta de losango abaixo). Renderizado inline em SVG para ficar nítido em
 * qualquer tamanho e herdar a cor do texto ao redor (via currentColor).
 */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <span className="brand-logo" style={{ fontSize: height }} aria-label="ZAPmoon" role="img">
      <span className="brand-word">Z</span>
      <svg
        className="brand-mark"
        viewBox="0 0 40 72"
        width={height * 0.62}
        height={height}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="zap-a" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a855f7" />
            <stop offset="1" stopColor="#7c3aed" />
          </linearGradient>
        </defs>
        {/* Triângulo do "A" com fenda central (evenodd) formando as duas pernas */}
        <path
          fill="url(#zap-a)"
          fillRule="evenodd"
          d="M20 3 L38 51 L2 51 Z M16.5 51 L16.5 30 L23.5 30 L23.5 51 Z"
        />
        {/* Ponta de losango abaixo da base */}
        <path fill="url(#zap-a)" d="M11 54 L29 54 L20 70 Z" />
      </svg>
      <span className="brand-word">Pmoon</span>
    </span>
  );
}
