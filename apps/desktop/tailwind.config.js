/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'var(--surface-0)',
        // 语义色：由 CSS 变量驱动，随 dark/light 主题切换
        s0: 'var(--surface-0)',
        s1: 'var(--surface-1)',
        s2: 'var(--surface-2)',
        s3: 'var(--surface-3)',
        s4: 'var(--surface-4)',
        line: 'var(--line)',
        linestrong: 'var(--line-strong)',
        t1: 'var(--text-1)',
        t2: 'var(--text-2)',
        t3: 'var(--text-3)',
        t4: 'var(--text-4)',
        brand: 'var(--brand)',
        'brand-strong': 'var(--brand-strong)',
        'brand-deep': 'var(--brand-deep)',
        'brand-on': 'var(--brand-on)',
        signal: 'var(--signal)',
      },
      fontFamily: {
        sans: ['Manrope', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'sans-serif'],
        display: ['Georgia', 'Times New Roman', 'Songti SC', 'STSong', 'SimSun', 'serif'],
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
}
