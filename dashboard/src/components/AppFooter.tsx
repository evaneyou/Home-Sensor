/** The copyright line at the bottom of every page, and under the sign-in box. */
export default function AppFooter() {
  return (
    <footer className="app-footer">
      <span>Copyright &copy; 2026 Evan You. All rights reserved.</span>
      <span>
        <a href="https://github.com/evaneyou/homenetwatch/blob/main/LICENSE" target="_blank" rel="noopener noreferrer">
          MIT License
        </a>
        <a href="https://github.com/evaneyou/homenetwatch" target="_blank" rel="noopener noreferrer">
          Source
        </a>
      </span>
    </footer>
  );
}
