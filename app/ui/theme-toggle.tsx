"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">("light");

  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
    read();
    window.addEventListener("enderchest-theme", read);
    return () => window.removeEventListener("enderchest-theme", read);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("enderchest-theme", next);
    setTheme(next);
    window.dispatchEvent(new Event("enderchest-theme"));
  }

  return <button className="icon-button theme-toggle" type="button" onClick={toggle}
    title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}>
    {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
  </button>;
}
