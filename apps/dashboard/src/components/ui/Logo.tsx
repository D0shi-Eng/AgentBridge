/**
 * شعار AgentBridge — جسر يصل SaaS بالوكلاء، بعقدة خضراء = قرار موثوق.
 * زخرفي بجانب النص المرافق دائماً، ف يُخفى عن قارئ الشاشة لتفادي الازدواج.
 */

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id="ab-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#ab-g)" />
      {/* جسر مقوس: منصة المصدر ← العبارة ← منصة الوكلاء */}
      <path d="M10 32 C 18 20, 30 20, 38 32" stroke="#fff" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <line x1="8" y1="33" x2="40" y2="33" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
      <line x1="13" y1="33" x2="13" y2="38" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <line x1="35" y1="33" x2="35" y2="38" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      {/* عقدة البيانات المتدفقة فوق القوس */}
      <circle cx="24" cy="22.5" r="4" fill="#eafff2" stroke="#14532d" strokeWidth="1.6" />
    </svg>
  );
}
