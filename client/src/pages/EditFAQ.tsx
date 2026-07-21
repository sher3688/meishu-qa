import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { categories } from "@/data/faqData";
import { ArrowLeft, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";

interface EditFAQProps {
  faqId: string;
}

export default function EditFAQ({ faqId }: EditFAQProps) {
  const [, setLocation] = useLocation();
  const { user } = useAuth();
  const [formData, setFormData] = useState({
    question: "",
    answer: "",
    category: "moving-in",
    imageUrls: [] as string[],
  });
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [uploadingImages, setUploadingImages] = useState(false);

  const trpcUtils = trpc.useUtils();
  const updateFAQMutation = trpc.faq.update.useMutation({
    onSuccess: () => {
      trpcUtils.faq.list.invalidate();
    },
  });

  const { data: allFAQs = [] } = trpc.faq.list.useQuery();

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

  // Load FAQ data
  useEffect(() => {
    const faqId_num = parseInt(faqId);
    console.log("EditFAQ - faqId:", faqId, "parsed:", faqId_num);
    console.log("EditFAQ - allFAQs:", allFAQs);

    if (allFAQs && allFAQs.length > 0) {
      const faq = allFAQs.find((f: any) => f.id === faqId_num);
      if (faq) {
        console.log("Found FAQ:", faq);
        setFormData({
          question: faq.question || "",
          answer: faq.answer || "",
          category: faq.category || "moving-in",
          imageUrls: faq.imageUrls ? JSON.parse(faq.imageUrls) : [],
        });
      } else {
        console.warn(
          "FAQ not found with id:",
          faqId_num,
          "Available IDs:",
          allFAQs.map((f: any) => f.id)
        );
      }
    }

    // Always set loading to false after a delay
    const timer = setTimeout(() => {
      setIsInitialLoading(false);
    }, 500);

    return () => clearTimeout(timer);
  }, [allFAQs, faqId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (
      !formData.question.trim() ||
      !formData.answer.trim() ||
      formData.category === "all"
    ) {
      toast.error("請填寫所有必填欄位");
      return;
    }

    setIsLoading(true);
    try {
      await updateFAQMutation.mutateAsync({
        id: parseInt(faqId),
        question: formData.question,
        answer: formData.answer,
        category: formData.category,
        imageUrls: formData.imageUrls.length > 0 ? JSON.stringify(formData.imageUrls) : undefined,
      });

      toast.success("問答已成功更新！");

      // Redirect back to home after 1.5 seconds
      setTimeout(() => {
        setLocation("/");
      }, 1500);
    } catch (error) {
      toast.error("更新問答失敗，請稍後重試");
      console.error("Failed to update FAQ:", error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 bg-white shadow-sm border-b border-border">
        <div className="container py-4">
          <div className="flex items-center gap-3 mb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation("/")}
              className="gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              返回
            </Button>
            <h1 className="text-2xl font-bold text-primary">編輯問答</h1>
          </div>
        </div>
      </header>

      <main className="container py-8">
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>編輯常見問題</CardTitle>
            <CardDescription>修改問題內容、答案和分類</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Category */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  分類 *
                </label>
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
                      .map((cat) => (
                        <SelectItem key={cat.id} value={cat.id}>
                          {cat.icon} {cat.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Question */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  問題 *
                </label>
                <Input
                  type="text"
                  placeholder="輸入問題"
                  value={formData.question}
                  onChange={(e) =>
                    setFormData({ ...formData, question: e.target.value })
                  }
                  disabled={isLoading}
                />
              </div>

              {/* Answer */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">
                  答案 *
                </label>
                <Textarea
                  placeholder="輸入詳細答案"
                  value={formData.answer}
                  onChange={(e) =>
                    setFormData({ ...formData, answer: e.target.value })
                  }
                  disabled={isLoading}
                  rows={6}
                />
              </div>

              {/* Image Upload */}
              <div className="space-y-2">
                <label className="text-sm font-semibold text-foreground">圖片 (可選)</label>
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
                  disabled={isLoading}
                >
                  取消
                </Button>
                <Button
                  type="submit"
                  disabled={isLoading}
                  className="gap-2"
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isLoading ? "更新中..." : "更新問答"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
