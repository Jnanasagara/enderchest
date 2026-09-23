import AuthForm from "../ui/auth-form";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  return <AuthForm mode="register" initialInvite={invite ?? ""} />;
}
