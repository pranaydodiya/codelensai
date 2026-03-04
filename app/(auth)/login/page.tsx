import React from "react";
import LoginUI from "@/module/auth/components/login-ui";

const LoginPage = async () => {
  // Removed requireUnauth to prevent database timeout errors
  // Session check will happen client-side in LoginUI component
  return <LoginUI />;
};

export default LoginPage;
