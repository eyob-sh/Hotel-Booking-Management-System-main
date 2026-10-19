import React, { useEffect, useMemo, useState } from "react";
import LoadingSpinner from "../components/LoadingSpinner";
import { useQuery } from "react-query";
import * as apiClient from "../api-client";
import { useToast } from "../hooks/use-toast";
import type { UserType } from "../../../shared/types";

type ToastMessage = {
  title: string;
  description?: string;
  type: "SUCCESS" | "ERROR" | "INFO";
};

export type AppContext = {
  showToast: (toastMessage: ToastMessage) => void;
  isLoggedIn: boolean;
  user: UserType | null;
  isLoading: boolean;
  showGlobalLoading: (message?: string) => void;
  hideGlobalLoading: () => void;
  isGlobalLoading: boolean;
  globalLoadingMessage: string;
};

export const AppContext = React.createContext<AppContext | undefined>(undefined);

export const AppContextProvider = ({ children }: { children: React.ReactNode }) => {
  const [isGlobalLoading, setIsGlobalLoading] = useState(false);
  const [globalLoadingMessage, setGlobalLoadingMessage] = useState(
    "Hotel room is getting ready..."
  );

  const { toast } = useToast();

  useEffect(() => {
    localStorage.removeItem("session_id");
  }, []);

  const {
    data: validateData,
    isLoading: isAuthLoading,
    isError,
    error,
  } = useQuery("validateToken", apiClient.validateToken, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60 * 1000,
  });

  const isLoggedIn = !isAuthLoading && !isError && !!validateData;

  const { data: user } = useQuery<UserType>(
    "currentUser",
    apiClient.fetchCurrentUser,
    {
      enabled: isLoggedIn,
      retry: false,
      refetchOnWindowFocus: false,
    }
  );

  useEffect(() => {
    const status = (error as any)?.response?.status;
    if (status === 401) {
      localStorage.removeItem("user_id");
    }
  }, [error]);

  const showToast = (toastMessage: ToastMessage) => {
    const variant =
      toastMessage.type === "SUCCESS"
        ? "success"
        : toastMessage.type === "ERROR"
        ? "destructive"
        : "info";

    toast({
      variant,
      title: toastMessage.title,
      description: toastMessage.description,
    });
  };

  const showGlobalLoading = (message?: string) => {
    if (message) setGlobalLoadingMessage(message);
    setIsGlobalLoading(true);
  };

  const hideGlobalLoading = () => setIsGlobalLoading(false);

  const value = useMemo(
    () => ({
      showToast,
      isLoggedIn,
      user: user ?? null,
      isLoading: isAuthLoading,
      showGlobalLoading,
      hideGlobalLoading,
      isGlobalLoading,
      globalLoadingMessage,
    }),
    [isLoggedIn, user, isGlobalLoading, globalLoadingMessage, isAuthLoading]
  );

  return (
    <AppContext.Provider value={value}>
      {isGlobalLoading && <LoadingSpinner message={globalLoadingMessage} />}
      {children}
    </AppContext.Provider>
  );
};