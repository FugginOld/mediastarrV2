import { createBrowserRouter } from "react-router-dom";
import { DashboardPage } from "../pages/DashboardPage";
import { SetupPage } from "../pages/SetupPage";
import { LoginPage } from "../pages/LoginPage";

export const router = createBrowserRouter([
  { path: "/", element: <DashboardPage /> },
  { path: "/setup", element: <SetupPage /> },
  { path: "/login", element: <LoginPage /> },
]);
