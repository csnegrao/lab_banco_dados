import { useEffect, useRef } from "react";

// "Chuva de código" ao fundo da área do aluno. Canvas fixo atrás do conteúdo,
// ~20 quadros/s, pausa com a aba escondida e fica parada com prefers-reduced-motion.
const CHARS = "アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワン0123456789SELECTFROMWHEREJOIN{}[]<>=;";

export default function MatrixRain({ intensidade = 0.22 }: { intensidade?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    const ctx = canvas.getContext("2d")!;
    const reduzir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tam = 16;
    let gotas: number[] = [];
    let raf = 0, ultimo = 0;

    const ajustar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + "px";
      canvas.style.height = window.innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const colunas = Math.ceil(window.innerWidth / tam);
      gotas = Array.from({ length: colunas }, () => Math.floor(Math.random() * -60));
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    };

    const quadro = () => {
      ctx.fillStyle = "rgba(0, 0, 0, 0.08)";
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
      ctx.font = `${tam}px "VT323", monospace`;
      for (let i = 0; i < gotas.length; i++) {
        const y = gotas[i] * tam;
        if (y > 0) {
          const c = CHARS[Math.floor(Math.random() * CHARS.length)];
          ctx.fillStyle = Math.random() < 0.04 ? "#d6ffe0" : "#00ff66";
          ctx.fillText(c, i * tam, y);
        }
        gotas[i] = y > window.innerHeight && Math.random() > 0.975 ? 0 : gotas[i] + 1;
      }
    };

    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (document.hidden || t - ultimo < 50) return;
      ultimo = t;
      quadro();
    };

    ajustar();
    if (reduzir) { for (let k = 0; k < 120; k++) quadro(); }
    else raf = requestAnimationFrame(loop);
    window.addEventListener("resize", ajustar);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", ajustar); };
  }, []);
  return <canvas ref={ref} aria-hidden className="mx-rain" style={{ opacity: intensidade }} />;
}
