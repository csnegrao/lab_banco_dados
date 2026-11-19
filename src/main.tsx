import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import AlunoApp from "./aluno/AlunoApp";
import AdminApp from "./admin/AdminApp";

const admin = window.location.pathname.startsWith("/admin");
createRoot(document.getElementById("root")!).render(<StrictMode>{admin ? <AdminApp /> : <AlunoApp />}</StrictMode>);
