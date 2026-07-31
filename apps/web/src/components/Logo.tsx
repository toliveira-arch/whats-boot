/**
 * Marca ZAPmoon. O "A" é o símbolo: triângulo roxo apontando para cima com o
 * contorno interno em "A" (sem barra) e a ponta de losango logo abaixo.
 * Renderizado inline em SVG para ficar nítido em qualquer tamanho; o texto
 * herda a cor ao redor (branco na nav, escuro no login).
 */
export function Logo({ height = 26 }: { height?: number }) {
  return (
    <span className="brand-logo" style={{ fontSize: height }} aria-label="ZAPmoon" role="img">
      <span className="brand-word">Z</span>
      <svg
        className="brand-mark"
        viewBox="0 0 44 74"
        width={(height * 1.32 * 44) / 74}
        height={height * 1.32}
        aria-hidden="true"
      >
        {/* Triângulo do "A" com o contra-forma (counter) triangular formando as pernas */}
        <path fill="#7a29e0" fillRule="evenodd" d="M22 2 L42 52 L2 52 Z M22 23 L15 52 L29 52 Z" />
        {/* Ponta de losango abaixo da base */}
        <path fill="#7a29e0" d="M13 56 L31 56 L22 72 Z" />
      </svg>
      <span className="brand-word">Pmoon</span>
    </span>
  );
}
