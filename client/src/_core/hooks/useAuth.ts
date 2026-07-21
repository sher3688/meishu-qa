import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo, useState } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  // 使用 useState 來監聽 localStorage 中的帳密登入信息
  const [passwordAuthUser, setPasswordAuthUser] = useState(() => {
    if (typeof window === 'undefined') return null;
    try {
      return JSON.parse(localStorage.getItem('passwordAuthUser') || 'null');
    } catch {
      return null;
    }
  });

  // 監聽 localStorage 變化
  useEffect(() => {
    const handleStorageChange = () => {
      try {
        const user = JSON.parse(localStorage.getItem('passwordAuthUser') || 'null');
        setPasswordAuthUser(user);
      } catch {
        setPasswordAuthUser(null);
      }
    };
    // 監聽 storage 事件（其他標籤頁的變化）
    window.addEventListener('storage', handleStorageChange);
    // 監聽自定義事件（同一標籤頁的變化）
    window.addEventListener('passwordAuthUserChanged', handleStorageChange);
    return () => {
      window.removeEventListener('storage', handleStorageChange);
      window.removeEventListener('passwordAuthUserChanged', handleStorageChange);
    };
  }, []);

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    enabled: !passwordAuthUser, // 如果已有帳密登入，不查詢 OAuth 使用者
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // 清除 OAuth 緩存
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
      // 清除帳密登入信息
      localStorage.removeItem('passwordAuthUser');
      localStorage.removeItem('passwordAuthToken');
      setPasswordAuthUser(null);
      // 重定向到登入頁面
      if (typeof window !== 'undefined') {
        window.location.href = getLoginUrl();
      }
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    // 帳密登入的使用者或 OAuth 使用者
    const user = passwordAuthUser || meQuery.data || null;
    return {
      user,
      loading: (!passwordAuthUser && meQuery.isLoading) || logoutMutation.isPending,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(user),
    };
  }, [
    passwordAuthUser,
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  // 將使用者信息保存到 localStorage（副作用應該在 useEffect 中執行）
  useEffect(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(state.user)
    );
  }, [state.user]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;
    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
