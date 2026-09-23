import { redirect } from "next/navigation";
import { getSessionUser } from "@/app/lib/auth/session";
import Drive from "./ui/drive";

export default async function Home() {
  if (!(await getSessionUser())) redirect("/login");
  return <Drive />;
}
