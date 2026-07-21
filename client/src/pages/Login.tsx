import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { BookOpen, AlertCircle } from "lucide-react";
import { useAuth } from "@/_core/hooks/useAuth";

export default function Login() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading } = useAuth();

  // 如果已登入，重導向到首頁
  if (!authLoading && user) {
    setLocation("/");
    return null;
  }

  // 如果還在載入中，顯示載入狀態
  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p>載入中...</p>
        </div>
      </div>
    );
  }

  return <LoginForm />;
}

function LoginForm() {
  const [, setLocation] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  // 登入 mutation
  const loginMutation = trpc.auth.passwordAuth.login.useMutation({
    onSuccess: (data) => {
      // 登入成功，儲存 JWT token 到 localStorage
      localStorage.setItem("passwordAuthToken", data.token || String(data.id));
      localStorage.setItem("passwordAuthUser", JSON.stringify(data));
      // 觸發自定義事件，通知 useAuth hook 更新
      window.dispatchEvent(new Event('passwordAuthUserChanged'));
      toast.success("登入成功");
      // 清除表單
      setUsername("");
      setPassword("");
      setLoading(false);
      // 延遲導航到首頁，讓所有狀態重新初始化
      setTimeout(() => {
        setLocation("/");
      }, 500);
    },
    onError: (error: any) => {
      const errorMsg = error?.data?.zodError 
        ? Object.values(error.data.zodError).flat().join(", ")
        : error.message || "登入失敗";
      toast.error(errorMsg);
      setLoading(false);
    },
    onSettled: () => {
      setLoading(false);
    },
  });

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      toast.error("請輸入使用者名稱和密碼");
      return;
    }
    setLoading(true);
    loginMutation.mutate({ username, password });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2">
          <div className="flex items-center justify-center mb-4">
            <div className="bg-primary/10 p-3 rounded-lg">
              <BookOpen className="w-6 h-6 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl text-center">美樹大悅社區問答系統</CardTitle>
          <CardDescription className="text-center">
            請輸入帳號密碼登入
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordLogin} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">使用者名稱</Label>
              <Input
                id="username"
                type="text"
                placeholder="輸入使用者名稱"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={loading}
                autoComplete="username"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">密碼</Label>
              <Input
                id="password"
                type="password"
                placeholder="輸入密碼"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="current-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={loading}
            >
              {loading ? "登入中..." : "登入"}
            </Button>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-3 flex items-start gap-2">
              <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-700">
                <p className="font-semibold mb-2">預設帳號：</p>
                <p className="text-xs">帳號：admin</p>
                <p className="text-xs">密碼：admin123</p>
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
