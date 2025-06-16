// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    // This line ensures Tailwind scans your main HTML file
    "./index.html",
    // This line is CRUCIAL: It tells Tailwind to scan all JS, TS, JSX, TSX files
    // within the 'src' directory and its subdirectories for Tailwind classes.
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {},
  },
  plugins: [],
};
