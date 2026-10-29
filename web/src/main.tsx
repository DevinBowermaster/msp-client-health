import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Dashboard } from "./Dashboard";
import { SurveyPage } from "./SurveyPage";
import "./styles.css";

// Two pages, so a router would be more code than it saves.
const surveyToken = /^\/survey\/([A-Za-z0-9_-]+)$/.exec(location.pathname)?.[1];

createRoot(document.getElementById("root")!).render(
  <StrictMode>{surveyToken ? <SurveyPage token={surveyToken} /> : <Dashboard />}</StrictMode>,
);
