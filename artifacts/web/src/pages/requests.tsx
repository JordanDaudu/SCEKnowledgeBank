import { useState } from "react";
import { 
  useListRequests, 
  useCreateRequest, 
  useVoteRequest,
  useUpdateRequest,
  getListRequestsQueryKey,
  useListCourses,
  useGetCurrentUser
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUp, Plus, Clock, CheckCircle2, Link as LinkIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { Link } from "wouter";

export default function Requests() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusTab, setStatusTab] = useState<"open" | "fulfilled" | "closed">("open");
  const [isCreating, setIsCreating] = useState(false);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState("");
  
  const { data: user } = useGetCurrentUser();
  const { data: courses } = useListCourses();
  const { data: requests, isLoading } = useListRequests({ status: statusTab }, {
    query: { queryKey: getListRequestsQueryKey({ status: statusTab }) }
  });

  const isLecturerOrAdmin = user?.roles?.includes("lecturer") || user?.roles?.includes("admin");

  const createMutation = useCreateRequest();
  const voteMutation = useVoteRequest();
  const updateMutation = useUpdateRequest();

  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCourse, setNewCourse] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) return;

    createMutation.mutate({
      data: {
        title: newTitle,
        description: newDesc,
        courseId: newCourse && newCourse !== "none" ? newCourse : undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: "Request created" });
        setIsCreating(false);
        setNewTitle("");
        setNewDesc("");
        setNewCourse("");
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: "open" }) });
      }
    });
  };

  const handleVote = (id: string) => {
    voteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: statusTab }) });
      },
      onError: (err) => {
        const data = (err as { data?: { error?: { message?: string } } })?.data;
        toast({ variant: "destructive", title: "Could not vote", description: data?.error?.message || "Already voted or not allowed." });
      }
    });
  };

  const handleFulfill = (id: string) => {
    // Basic extraction of ID if they pasted a full URL
    let fulfillingDocumentId = docUrl;
    if (docUrl.includes("/documents/")) {
      fulfillingDocumentId = docUrl.split("/documents/")[1].split("/")[0];
    }
    
    updateMutation.mutate({
      id,
      data: { status: "fulfilled", fulfillingDocumentId }
    }, {
      onSuccess: () => {
        toast({ title: "Request marked as fulfilled" });
        setFulfillingId(null);
        setDocUrl("");
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: statusTab }) });
      }
    });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Material Requests</h1>
          <p className="text-muted-foreground mt-1">Ask for missing notes or upvote existing requests.</p>
        </div>
        <Button onClick={() => setIsCreating(!isCreating)}>
          <Plus className="mr-2 h-4 w-4" /> New Request
        </Button>
      </div>

      {isCreating && (
        <Card className="border-primary bg-primary/5">
          <CardHeader>
            <CardTitle>Create Request</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">Title *</label>
                <Input 
                  value={newTitle} 
                  onChange={e => setNewTitle(e.target.value)} 
                  placeholder="e.g. Midterm 2022 Solutions" 
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium">Course</label>
                <Select value={newCourse} onValueChange={setNewCourse}>
                  <SelectTrigger className="bg-background"><SelectValue placeholder="Optional course" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {courses?.map(c => <SelectItem key={c.id} value={c.id}>{c.code}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Details</label>
                <Textarea 
                  value={newDesc} 
                  onChange={e => setNewDesc(e.target.value)} 
                  placeholder="Any specific professor or year?" 
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>Cancel</Button>
                <Button type="submit" disabled={!newTitle || createMutation.isPending}>Submit</Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Tabs value={statusTab} onValueChange={(val) => setStatusTab(val as typeof statusTab)} className="w-full">
        <TabsList className="grid w-full grid-cols-3 mb-6">
          <TabsTrigger value="open">Open</TabsTrigger>
          <TabsTrigger value="fulfilled">Fulfilled</TabsTrigger>
          <TabsTrigger value="closed">Closed</TabsTrigger>
        </TabsList>
        
        <TabsContent value={statusTab} className="space-y-4 mt-0">
          {isLoading ? (
            <div className="text-center py-10"><Clock className="animate-spin h-6 w-6 mx-auto text-muted-foreground" /></div>
          ) : requests?.length === 0 ? (
            <div className="text-center py-20 bg-card rounded-xl border border-dashed">
              <p className="text-muted-foreground">No {statusTab} requests found.</p>
            </div>
          ) : (
            requests?.map(req => (
              <Card key={req.id} className="overflow-hidden">
                <div className="flex flex-col sm:flex-row">
                  {/* Vote Column */}
                  <div className="bg-secondary/50 p-4 flex sm:flex-col items-center justify-center sm:justify-start gap-2 border-b sm:border-b-0 sm:border-r min-w-[80px]">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className={`h-8 w-8 rounded-full ${req.hasVoted ? 'bg-primary/20 text-primary hover:bg-primary/30' : 'hover:bg-secondary'}`}
                      onClick={() => handleVote(req.id)}
                      disabled={req.status !== 'open' || req.hasVoted || voteMutation.isPending}
                      title={req.hasVoted ? "You have already voted" : "Upvote this request"}
                    >
                      <ArrowUp className="h-5 w-5" />
                    </Button>
                    <span className="font-bold text-lg">{req.voteCount}</span>
                  </div>
                  
                  {/* Content Column */}
                  <CardContent className="p-5 flex-1">
                    <div className="flex justify-between items-start mb-1">
                      <h3 className="font-serif font-semibold text-lg">{req.title}</h3>
                      <div className="flex gap-2">
                        {req.status === 'fulfilled' && <Badge className="bg-green-600"><CheckCircle2 className="mr-1 w-3 h-3"/> Fulfilled</Badge>}
                        {req.status === 'closed' && <Badge variant="secondary">Closed</Badge>}
                        {isLecturerOrAdmin && req.status === 'open' && fulfillingId !== req.id && (
                          <Button variant="outline" size="sm" onClick={() => setFulfillingId(req.id)}>Fulfill</Button>
                        )}
                      </div>
                    </div>
                    
                    <p className="text-muted-foreground text-sm mb-4">{req.description}</p>
                    
                    {fulfillingId === req.id && (
                      <div className="bg-secondary p-3 rounded-md flex gap-2 items-center mb-4">
                        <Input 
                          placeholder="Paste document ID or URL..." 
                          value={docUrl} 
                          onChange={e => setDocUrl(e.target.value)}
                          className="bg-background"
                        />
                        <Button size="sm" onClick={() => handleFulfill(req.id)} disabled={!docUrl || updateMutation.isPending}>Submit</Button>
                        <Button variant="ghost" size="sm" onClick={() => setFulfillingId(null)}>Cancel</Button>
                      </div>
                    )}

                    {req.fulfillingDocumentId && (
                      <Link href={`/documents/${req.fulfillingDocumentId}`}>
                        <div className="mb-4 inline-flex items-center gap-2 text-sm text-primary bg-primary/5 px-3 py-1.5 rounded-md hover:bg-primary/10 transition-colors">
                          <LinkIcon className="h-4 w-4" /> View fulfilled document
                        </div>
                      </Link>
                    )}
                    
                    <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground mt-auto pt-2 border-t border-border/50">
                      {req.course && <Badge variant="outline" className="font-mono bg-background">{req.course.code}</Badge>}
                      <span>Requested by {req.requestedBy.displayName}</span>
                      <span>{formatDateTime(req.createdAt)}</span>
                    </div>
                  </CardContent>
                </div>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
