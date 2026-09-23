import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth/session";
import AuthForm from "../ui/auth-form";

export default async function LoginPage() {
  if (await getSessionUser()) redirect("/");
  return <AuthForm mode="login" />;
}
