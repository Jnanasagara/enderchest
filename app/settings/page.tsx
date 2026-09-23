import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth/session";
import SettingsClient from "./settings-client";

export default async function SettingsPage() {
  if (!await getSessionUser()) redirect("/login");
  return <SettingsClient />;
}
