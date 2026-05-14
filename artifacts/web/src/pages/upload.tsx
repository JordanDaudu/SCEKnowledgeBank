import { useState, useRef } from "react";
import { useUploadDocuments, useListCourses, useListCategories, useListTags } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { UploadCloud, X, File, CheckCircle2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";

export default function Upload() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [files, setFiles] = useState<File[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [materialType, setMaterialType] = useState<string>("");
  type Visibility = "public" | "restricted" | "private";
  type Semester = "fall" | "spring" | "summer" | "";
  const [visibility, setVisibility] = useState<Visibility>("public");
  const [semester, setSemester] = useState<Semester>("");
  const [academicYear, setAcademicYear] = useState<string>(new Date().getFullYear().toString());
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  
  const uploadMutation = useUploadDocuments();
  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: availableTags } = useListTags();

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) {
      setFiles(prev => [...prev, ...Array.from(e.dataTransfer.files!)]);
    }
  };
  
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      setFiles(prev => [...prev, ...Array.from(e.target.files!)]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const toggleTag = (tagId: string) => {
    setSelectedTags(prev => prev.includes(tagId) ? prev.filter(t => t !== tagId) : [...prev, tagId]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!files.length) {
      toast({ variant: "destructive", title: "No files", description: "Please select at least one file." });
      return;
    }
    if (!courseId || !materialType) {
      toast({ variant: "destructive", title: "Missing fields", description: "Course and Material Type are required." });
      return;
    }

    uploadMutation.mutate({
      data: {
        files: files as unknown as Blob[], // Orval expects Blob array
        courseId,
        categoryId: categoryId || undefined,
        materialType,
        visibility,
        semester: (semester || undefined) as Semester extends "" ? undefined : Exclude<Semester, "">,
        academicYear: academicYear ? parseInt(academicYear) : undefined,
        tagIds: selectedTags.length > 0 ? selectedTags : undefined
      }
    }, {
      onSuccess: (data) => {
        toast({ title: "Upload complete", description: `Successfully uploaded ${data.results.filter(r => r.success).length} files.` });
        setTimeout(() => setLocation("/browse"), 1500);
      },
      onError: (err) => {
        const data = (err as { data?: { error?: { message?: string } } })?.data;
        toast({ variant: "destructive", title: "Upload failed", description: data?.error?.message || (err as Error)?.message || "An error occurred during upload." });
      }
    });
  };

  const materialTypes = ["lecture-notes", "problem-set", "exam", "syllabus", "slides", "project-report", "textbook"];

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">Upload Materials</h1>
        <p className="text-muted-foreground mt-1">Share documents with the university community.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        <Card>
          <CardHeader>
            <CardTitle>Files</CardTitle>
            <CardDescription>Drag & drop or select files to upload.</CardDescription>
          </CardHeader>
          <CardContent>
            <div 
              className="border-2 border-dashed border-primary/20 rounded-xl p-10 text-center hover:bg-primary/5 transition-colors cursor-pointer"
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <UploadCloud className="h-10 w-10 text-primary mx-auto mb-4" />
              <p className="font-medium">Click to browse or drag files here</p>
              <p className="text-sm text-muted-foreground mt-1">PDF, DOCX, PPTX up to 50MB</p>
              <input 
                type="file" 
                multiple 
                className="hidden" 
                ref={fileInputRef} 
                onChange={handleFileSelect}
              />
            </div>

            {files.length > 0 && (
              <div className="mt-6 space-y-3">
                {files.map((file, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-secondary rounded-lg border">
                    <div className="flex items-center gap-3">
                      <File className="h-5 w-5 text-muted-foreground" />
                      <span className="text-sm font-medium truncate max-w-[200px] sm:max-w-sm">{file.name}</span>
                      <span className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    {uploadMutation.isSuccess ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Button type="button" variant="ghost" size="icon" onClick={() => removeFile(i)} className="h-8 w-8">
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Applied to all files in this batch.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Course *</label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger><SelectValue placeholder="Select course" /></SelectTrigger>
                  <SelectContent>
                    {courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.code} - {c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Material Type *</label>
                <Select value={materialType} onValueChange={setMaterialType}>
                  <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                  <SelectContent>
                    {materialTypes.map(t => <SelectItem key={t} value={t} className="capitalize">{t.replace("-", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Category</label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {categories?.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Visibility</label>
                <Select value={visibility} onValueChange={(val) => setVisibility(val as Visibility)}>
                  <SelectTrigger><SelectValue placeholder="Visibility" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public (Everyone)</SelectItem>
                    <SelectItem value="restricted">Restricted (Enrolled only)</SelectItem>
                    <SelectItem value="private">Private (Only me)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Semester</label>
                <Select value={semester} onValueChange={(val) => setSemester(val === "none" ? "" : (val as Semester))}>
                  <SelectTrigger><SelectValue placeholder="Select semester" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    <SelectItem value="fall">Fall</SelectItem>
                    <SelectItem value="spring">Spring</SelectItem>
                    <SelectItem value="summer">Summer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Academic Year</label>
                <Input type="number" value={academicYear} onChange={e => setAcademicYear(e.target.value)} placeholder="e.g. 2024" />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Tags</label>
              <div className="flex flex-wrap gap-2">
                {availableTags?.map(tag => (
                  <Badge 
                    key={tag.id} 
                    variant={selectedTags.includes(tag.id) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleTag(tag.id)}
                  >
                    {tag.name}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-4">
          <Button type="button" variant="outline" onClick={() => setLocation("/")}>Cancel</Button>
          <Button type="submit" disabled={files.length === 0 || !courseId || !materialType || uploadMutation.isPending}>
            {uploadMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Upload {files.length} Files
          </Button>
        </div>
      </form>
    </div>
  );
}
