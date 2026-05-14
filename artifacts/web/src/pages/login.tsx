import { useState } from "react";
import { useLogin, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { BookOpen, User, BookA, ShieldAlert, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const loginSchema = z.object({
  email: z.string().min(1, { message: "Email is required." }),
  password: z.string().min(1, { message: "Password is required." }),
});

export default function Login() {
  const [, setLocation] = useLocation();
  const loginMutation = useLogin();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  // If already logged in, redirect
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();
  if (user && !isUserLoading) {
    setLocation("/");
  }

  const form = useForm<z.infer<typeof loginSchema>>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (values: z.infer<typeof loginSchema>) => {
    loginMutation.mutate({ data: values }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
        toast({
          title: "Welcome back",
          description: `Logged in as ${data.displayName}`,
        });
        setLocation("/");
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: "Login failed",
          description: error?.data?.error?.message || "Invalid credentials",
        });
      }
    });
  };

  const loginAsDemo = (email: string) => {
    form.setValue("email", email);
    form.setValue("password", "demo1234");
    onSubmit({ email, password: "demo1234" });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-0 left-0 w-full h-[40vh] bg-primary/5 rounded-b-[100%] border-b border-primary/10 pointer-events-none" />
      
      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/50">
        <CardHeader className="text-center pb-8 pt-10">
          <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-3">
            <BookOpen className="h-8 w-8 text-primary-foreground -rotate-3" />
          </div>
          <CardTitle className="font-serif text-3xl mb-2">Knowledge Bank</CardTitle>
          <CardDescription className="text-base">
            The university's scholarly reading room.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-center text-muted-foreground uppercase tracking-wider">Quick Login</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all group"
                onClick={() => loginAsDemo("student@demo")}
                type="button"
              >
                <User className="mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold">Student</span>
                  <span className="text-xs text-muted-foreground">Riley C.</span>
                </div>
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all group"
                onClick={() => loginAsDemo("lecturer@demo")}
                type="button"
              >
                <BookA className="mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold">Lecturer</span>
                  <span className="text-xs text-muted-foreground">Dr. Reyes</span>
                </div>
              </Button>
              <Button 
                variant="outline" 
                className="w-full justify-start h-auto py-3 bg-card hover:bg-primary/5 hover:text-primary hover:border-primary/50 transition-all group"
                onClick={() => loginAsDemo("admin@demo")}
                type="button"
              >
                <ShieldAlert className="mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                <div className="flex flex-col items-start">
                  <span className="text-sm font-semibold">Admin</span>
                  <span className="text-xs text-muted-foreground">Sasha P.</span>
                </div>
              </Button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input placeholder="name@university.edu" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-11 text-base mt-2" disabled={loginMutation.isPending}>
                {loginMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Sign In
              </Button>
            </form>
          </Form>
        </CardContent>
        <CardFooter className="justify-center pb-8">
          <p className="text-sm text-muted-foreground">
            Trusted by the academic community.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
