/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg:      { primary: "#2A2C2E", secondary: "#1E2022", surface: "#353739", border: "#3F4143" },
        accent:  { blue: "#00B0F0", amber: "#D77B12" },
        status:  { green: "#22C55E", red: "#EF4444", amber: "#F59E0B", grey: "#6B7280" },
        text:    { primary: "#F0F0F0", muted: "#9CA3AF", dim: "#6B7280" },
      },
      fontFamily: {
        display: ["'ADLaM Display'", "Calibri", "serif"],
        body:    ["'Dubai'", "'Dubai Light'", "Calibri", "sans-serif"],
      },
    },
  },
  plugins: [],
}
