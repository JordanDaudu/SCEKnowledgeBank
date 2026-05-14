import { useListRecentDocuments, useListDocuments } from "@workspace/api-client-react";
import { SearchBar } from "@/components/search-bar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BookOpen, FileText, ChevronRight, Clock, Library } from "lucide-react";
import { Link } from "wouter";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

export default function Home() {
  const { data: recentDocs, isLoading: isLoadingRecent } = useListRecentDocuments({ limit: 4 });
  const { data: latestDocsPage, isLoading: isLoadingLatest } = useListDocuments({ sort: "newest", pageSize: 4 });

  const renderDocumentCard = (doc: any) => (
    <Link key={doc.id} href={`/documents/${doc.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate">
        <CardContent className="p-5 flex flex-col h-full">
          <div className="flex justify-between items-start mb-3">
            <div className="bg-secondary p-2 rounded-md text-primary">
              <FileText className="h-5 w-5" />
            </div>
            {doc.course && (
              <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded text-muted-foreground">
                {doc.course.code}
              </span>
            )}
          </div>
          <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-1">{doc.title}</h3>
          <div className="text-sm text-muted-foreground mt-auto flex justify-between items-center pt-4">
            <span className="capitalize">{doc.materialType.replace("-", " ")}</span>
            <span className="text-xs">{formatDateTime(doc.createdAt)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );

  return (
    <div className="space-y-12 pb-12">
      <section className="bg-primary/5 -mx-4 px-4 py-16 sm:py-24 rounded-b-[3rem] border-b border-primary/10">
        <div className="max-w-3xl mx-auto text-center space-y-6">
          <h1 className="text-4xl sm:text-5xl font-serif font-bold text-foreground tracking-tight">
            The Knowledge Bank
          </h1>
          <p className="text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            Discover, discuss, and request academic materials curated for your university coursework.
          </p>
          <div className="pt-4 max-w-2xl mx-auto">
            <SearchBar autoFocus />
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto space-y-12">
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
              <Clock className="h-6 w-6 text-primary" />
              Continue Reading
            </h2>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {isLoadingRecent ? (
              Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
            ) : recentDocs && recentDocs.length > 0 ? (
              recentDocs.map(renderDocumentCard)
            ) : (
              <div className="col-span-full text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">You haven't viewed any documents yet.</p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
              <Library className="h-6 w-6 text-primary" />
              Latest Additions
            </h2>
            <Link href="/browse" className="text-primary font-medium hover:underline flex items-center text-sm">
              View all <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {isLoadingLatest ? (
              Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
            ) : latestDocsPage?.items && latestDocsPage.items.length > 0 ? (
              latestDocsPage.items.map(renderDocumentCard)
            ) : (
              <div className="col-span-full text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">No documents available.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
