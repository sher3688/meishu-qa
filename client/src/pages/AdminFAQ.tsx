import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { categories } from "@/data/faqData";
import { ArrowLeft, Plus, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

export default function AdminFAQ() {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    category: "all",
    imageUrls: [] as string[],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [uploadingImages, setUploadingImages] = useState(false);

  const trpcUtils = trpc.useUtils();
  const createFAQMutation = trpc.faq.create.useMutation({
    onSuccess: () => {
      // Invalidate the FAQ list query to refetch data
      trpcUtils.faq.list.invalidate();
    },
  });

  // Redirect if not logged in
  if (!user) {
    setLocation("/login");
    return null;
  }

  // Redirect if not admin
  if (user && user.role !== "admin") {
    setLocation("/");
    return null;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.question.trim() || !formData.answer.trim() || formData.category === "all") {
      toast.error("請填寫所有必填欄位");
      return;
    }

    setIsLoading(true);
    try {
      await createFAQMutation.mutateAsync({
        question: formData.question,
        answer: formData.answer,
        category: formData.category,
        imageUrls: formData.imageUrls.length > 0 ? JSON.stringify(formData.imageUrls) : undefined,
      });

      toast.success("問答已成功新增！");
      setFormData({ question: "", answer: "", category: "all", imageUrls: [] });
      
      // Redirect back to home after 1.5 seconds
      setTimeout(() => {
        setLocation("/");
      }, 1500);
    } catch (error) {
      toast.error("新增問答失敗，請稍後重試");
      console.error("Failed to create FAQ:", error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white shadow-sm border-b border-border">
        <div className="container py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </Button>
            <h1 className="text-2xl font-bold text-primary">新增問答</h1>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle>新增社區常見問題</CardTitle>
              <CardDescription>
                填寫以下表單以新增一個新的常見問題和答案
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSubmit} className="space-y-6">
                {/* Category Select */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">分類 *</label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) =>
                      setFormData({ ...formData, category: value })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="選擇分類" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories
                        .filter((cat) => cat.id !== "all")
                        .map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.icon} {category.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Question Input */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">問題 *</label>
                  <Input
                    type="text"
                    placeholder="例如：社區的機車位是固定的嗎？"
                    value={formData.question}
                    onChange={(e) =>
                      setFormData({ ...formData, question: e.target.value })
                    }
                    disabled={isLoading}
                    className="w-full"
                  />
                </div>

                {/* Answer Textarea */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">答案 *</label>
                  <Textarea
                    placeholder="詳細的答案內容..."
                    value={formData.answer}
                    onChange={(e) =>
                      setFormData({ ...formData, answer: e.target.value })
                    }
                    disabled={isLoading}
                    className="w-full min-h-[200px]"
                  />
                </div>

                {/* Image Upload */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">圖片 (可選)</label>
                  <div className="border-2 border-dashed border-border rounded-lg p-4 text-center">
                    <input
                      type="file"
                      id="image-upload"
                      multiple
                      accept="image/*"
                      disabled={isLoading || uploadingImages}
                      onChange={async (e) => {
                        const files = Array.from(e.currentTarget.files || []);
                        if (files.length === 0) return;

                        setUploadingImages(true);
                        try {
                          const uploadedUrls: string[] = [];
                          for (const file of files) {
                            const formDataForUpload = new FormData();
                            formDataForUpload.append('file', file);
                            
                            // Upload to backend
                            const response = await fetch('/api/upload', {
                              method: 'POST',
                              body: formDataForUpload,
                            });
                            
                            if (response.ok) {
                              const data = await response.json();
                              uploadedUrls.push(data.url);
                            }
                          }
                          
                          setFormData({
                            ...formData,
                            imageUrls: [...formData.imageUrls, ...uploadedUrls],
                          });
                          toast.success(`已上傳 ${uploadedUrls.length} 張圖片`);
                        } catch (error) {
                          toast.error("圖片上傳失敗");
                          console.error("Image upload failed:", error);
                        } finally {
                          setUploadingImages(false);
                        }
                      }}
                      className="hidden"
                    />
                    <label
                      htmlFor="image-upload"
                      className="cursor-pointer flex flex-col items-center gap-2"
                    >
                      <Upload className="w-6 h-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">
                        點擊上傳或拖放圖片
                      </span>
                    </label>
                  </div>

                  {/* Image Preview */}
                  {formData.imageUrls.length > 0 && (
                    <div className="grid grid-cols-3 gap-2">
                      {formData.imageUrls.map((url, index) => (
                        <div key={index} className="relative group">
                          <img
                            src={url}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-24 object-cover rounded-lg"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              setFormData({
                                ...formData,
                                imageUrls: formData.imageUrls.filter((_, i) => i !== index),
                              });
                            }}
                            className="absolute top-1 right-1 bg-red-500 text-white p-1 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Submit Button */}
                <div className="flex gap-3 justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setLocation("/")}
                    disabled={isLoading || uploadingImages}
                  >
                    取消
                  </Button>
                  <Button
                    type="submit"
                    disabled={isLoading || uploadingImages}
                    className="gap-2"
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        新增中...
                      </>
                    ) : uploadingImages ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin" />
                        上傳中...
                      </>
                    ) : (
                      <>
                        <Plus className="w-4 h-4" />
                        新增問答
                      </>
                    )}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>
  );
}
