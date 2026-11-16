import { createRoot } from "react-dom/client";
import "../styles.css";

// Side panel entry (owned by the side panel build task).
createRoot(document.getElementById("root")!).render(<div className="p-4 text-sm">Hermes</div>);
