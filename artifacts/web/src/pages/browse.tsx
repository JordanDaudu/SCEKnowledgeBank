import { useState } from "react";
import { useListDocuments, getListDocumentsQueryKey, useListCourses, useListCategories, useListTags } from "@workspace/api-client-react";
import { useLocation, useSearch } from "wouter";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, FileText, Filter, SlidersHorizontal, BookOpen } from "lucide-react";
import { Link } from "wouter";

export default function Browse() {
  const searchParams = new URLSearchParams(useSearch());
  const initialQuery = searchParams.get("q") || "";
  
  const [query, setQuery] = useState(initialQuery);
  const [courseId, setCourseId] = useState<string>("all");
  const [materialType, setMaterialType] = useState<string>("all");
  const [sort, setSort] = useState<"newest" | "oldest" | "title" | "popularity">("newest");
  const [page, setPage] = useState(1);

  const { data: courses } = useListCourses();
  
  const { data: pageData, isLoading } = useListDocuments({
    q: query || undefined,
    courseId: courseId !== "all" ? courseId : undefined,
    materialType: materialType !== "all" ? materialType : undefined,
    sort,
    page,
    pageSize: 12
  });

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
  };

  const materialTypes = [
    "lecture-notes", "problem-set", "exam", "syllabus", "slides", "project-report", "textbook"
  ];

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Browse Library</h1>
          <p className="text-muted-foreground mt-1">Explore all available academic materials.</p>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-4 flex flex-col md:flex-row gap-4 shadow-sm">
        <form onSubmit={handleSearch} className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input 
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search titles, descriptions..." 
            className="pl-9 w-full bg-background"
          />
        </form>
        <div className="flex gap-2">
          <Select value={courseId} onValueChange={(val) => { setCourseId(val); setPage(1); }}>
            <SelectTrigger className="w-[160px] bg-background">
              <SelectValue placeholder="All Courses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Courses</SelectItem>
              {courses?.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={materialType} onValueChange={(val) => { setMaterialType(val); setPage(1); }}>
            <SelectTrigger className="w-[160px] bg-background">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {materialTypes.map(t => (
                <SelectItem key={t} value={t} className="capitalize">{t.replace("-", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(val: any) => { setSort(val); setPage(1); }}>
            <SelectTrigger className="w-[140px] bg-background">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="popularity">Most Viewed</SelectItem>
              <SelectItem value="title">A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
          </div>
        ) : pageData?.items && pageData.items.length > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {pageData.items.map(doc => (
                <Link key={doc.id} href={`/documents/${doc.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate flex flex-col">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex justify-between items-start mb-3">
                        <div className="bg-secondary p-2 rounded-md text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        {doc.course && (
                          <Badge variant="outline" className="font-mono font-normal">
                            {doc.course.code}
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-2">{doc.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{doc.description}</p>
                      
                      <div className="mt-auto flex justify-between items-center pt-2">
                        <Badge variant="secondary" className="capitalize text-xs font-normal">
                          {doc.materialType.replace("-", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(doc.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>
            
            {pageData.total > pageData.pageSize && (
              <div className="flex justify-center mt-8 gap-2">
                <Button 
                  variant="outline" 
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                >
                  Previous
                </Button>
                <div className="flex items-center px-4 text-sm font-medium">
                  Page {page} of {Math.ceil(pageData.total / pageData.pageSize)}
                </div>
                <Button 
                  variant="outline" 
                  disabled={page >= Math.ceil(pageData.total / pageData.pageSize)}
                  onClick={() => setPage(p => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-card border border-dashed rounded-xl">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">No materials found</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              Try adjusting your search filters or browse a different course.
            </p>
            <Button variant="outline" className="mt-6" onClick={() => {
              setQuery("");
              setCourseId("all");
              setMaterialType("all");
              setSort("newest");
              setPage(1);
            }}>
              Clear Filters
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
