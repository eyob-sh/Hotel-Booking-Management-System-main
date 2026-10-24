import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "react-query";
import { useMutationWithLoading } from "../hooks/useLoadingHooks";
import * as apiClient from "../api-client";
import useAppContext from "../hooks/useAppContext";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Mail, Lock, Eye, EyeOff, LogIn, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Separator } from "../components/ui/separator";
export type SignInFormData = {
  /** Email address or phone number (Phase 2). */
  identifier: string;
  password: string;
};

const SignIn = () => {
  const { showToast } = useAppContext();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const location = useLocation();
  const { data: publicSettings } = useQuery(
    "publicSettings",
    apiClient.fetchPublicSettings,
    { staleTime: 5 * 60 * 1000, retry: false }
  );
  const phoneLoginEnabled = publicSettings?.features?.phoneLogin !== false;
  const {
    register,
    formState: { errors },
    handleSubmit,
  } = useForm<SignInFormData>();
  const mutation = useMutationWithLoading(apiClient.signIn, {
    onSuccess: async () => {
      showToast({
        title: "Sign In Successful",
        description:
          "Welcome back! You have been successfully signed in to your account.",
        type: "SUCCESS",
      });
      await Promise.all([
        queryClient.refetchQueries("validateToken"),
        queryClient.refetchQueries("currentUser"),
      ]);
      navigate(location.state?.from?.pathname || "/");
    },
    onError: (error: any) => {
      const status = error?.response?.status;
      const message = error?.response?.data?.message || "Invalid email or password";
      if (status === 401) {
        showToast({
          title: "Sign In Failed",
          description: message,
          type: "ERROR",
        });
        return;
      }
      showToast({
        title: "Sign In Failed",
        description: "Something went wrong. Please try again.",
        type: "ERROR",
      });
    },
    loadingMessage: "Signing you in...",
  });
  const onSubmit = handleSubmit((data) => {
    setIsLoading(true);
    mutation.mutate(data, {
      onSettled: () => setIsLoading(false),
    });
  });

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-gradient-to-br from-slate-50 via-primary-50/40 to-indigo-50/40 py-12 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, #1e3a8a 1px, transparent 0)",
          backgroundSize: "28px 28px",
        }}
      />
      <div className="relative w-full max-w-md">
        <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-large border border-white/60 p-8 sm:p-10">
          <div className="text-center mb-8">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-4 shadow-medium ring-4 ring-primary-100">
              <LogIn className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 tracking-tight">
              Welcome Back
            </h1>
            <p className="text-gray-500 mt-2 text-sm">
              Sign in to your account to continue
            </p>
          </div>
          <form className="space-y-5" onSubmit={onSubmit}>
            <div className="space-y-2">
              <Label
                htmlFor="identifier"
                className="text-sm font-semibold text-gray-700"
              >
                {phoneLoginEnabled ? "Email or Phone Number" : "Email Address"}
              </Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none z-10">
                  <Mail className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  id="identifier"
                  type={phoneLoginEnabled ? "text" : "email"}
                  className="pl-11 pr-3 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 bg-gray-50/60 focus:bg-white"
                  placeholder={
                    phoneLoginEnabled
                      ? "you@example.com or +251 9XX XXX XXX"
                      : "Enter your email"
                  }
                  {...register("identifier", {
                    required: "Email or phone is required",
                  })}
                />
              </div>
              {errors.identifier && (
                <p className="text-sm text-red-600 flex items-center gap-1.5 mt-1">
                  <Sparkles className="w-4 h-4" />
                  {errors.identifier.message}
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label
                htmlFor="password"
                className="text-sm font-semibold text-gray-700"
              >
                Password
              </Label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none z-10">
                  <Lock className="h-5 w-5 text-gray-400" />
                </div>
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  className="pl-11 pr-12 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all duration-200 bg-gray-50/60 focus:bg-white"
                  placeholder="Enter your password"
                  {...register("password", {
                    required: "Password is required",
                    minLength: {
                      value: 8,
                      message: "Password must be at least 8 characters",
                    },
                  })}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute inset-y-0 right-0 pr-2 h-full hover:bg-transparent"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  ) : (
                    <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                  )}
                </Button>
              </div>
              {errors.password && (
                <p className="text-sm text-red-600 flex items-center gap-1.5 mt-1">
                  <Sparkles className="w-4 h-4" />
                  {errors.password.message}
                </p>
              )}
            </div>
            <Button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 px-4 rounded-xl text-white bg-gradient-to-r from-primary-600 to-indigo-600 hover:from-primary-700 hover:to-indigo-700 transition-all duration-200 transform hover:scale-[1.01] disabled:opacity-50 disabled:cursor-not-allowed shadow-medium font-semibold"
            >
              {isLoading ? (
                <div className="flex items-center">
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  Signing in...
                </div>
              ) : (
                <div className="flex items-center justify-center">
                  <LogIn className="w-5 h-5 mr-2" />
                  Sign In
                </div>
              )}
            </Button>
            <div className="relative my-6">
              <Separator className="bg-gray-200" />
              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-white text-gray-400 uppercase tracking-wider">
                  or
                </span>
              </div>
            </div>
            <div className="text-center">
              <p className="text-sm text-gray-600">
                Don't have an account?{" "}
                <Link
                  to="/register"
                  className="font-semibold text-primary-600 hover:text-primary-700 transition-colors duration-200"
                >
                  Create one here
                </Link>
              </p>
            </div>
          </form>
          <div className="text-center mt-6 pt-6 border-t border-gray-100">
            <p className="text-xs text-gray-400">
              By signing in, you agree to our{" "}
              <a href="#" className="text-primary-600 hover:underline">
                Terms of Service
              </a>{" "}
              and{" "}
              <a href="#" className="text-primary-600 hover:underline">
                Privacy Policy
              </a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SignIn;