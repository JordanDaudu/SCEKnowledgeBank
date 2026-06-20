import { useState } from "react";
import {
  useRegisterUser,
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, BookA, User } from "lucide-react";
import { Logo } from "@/components/logo";

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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardFooter,
} from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

// Mirror the server-side rules from `auth.service.ts`: ≥8 chars,
// at least one letter and one number.
const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d).+$/;

const registerSchema = z
  .object({
    fullName: z.string().trim().min(1, "Your full name is required."),
    email: z
      .string()
      .trim()
      .min(1, "Email is required.")
      .email("Enter a valid email."),
    password: z
      .string()
      .min(8, "At least 8 characters.")
      .regex(PASSWORD_REGEX, "Must include a letter and a number."),
    confirmPassword: z.string().min(1, "Please confirm your password."),
    role: z.enum(["student", "lecturer"]),
    studentId: z.string().trim().max(64).optional(),
    lecturerId: z.string().trim().max(64).optional(),
    department: z.string().trim().max(120).optional(),
  })
  .refine((d) => d.password === d.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords do not match.",
  });

type RegisterValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [, setLocation] = useLocation();
  const registerMutation = useRegisterUser();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [role, setRole] = useState<"student" | "lecturer">("student");

  // If already logged in, hop straight to the home page — registration
  // doesn't make sense for an authenticated user.
  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();
  if (user && !isUserLoading) {
    setLocation("/");
  }

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      fullName: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "student",
      studentId: "",
      lecturerId: "",
      department: "",
    },
  });

  const onSubmit = (values: RegisterValues) => {
    registerMutation.mutate(
      { data: values },
      {
        onSuccess: (data) => {
          if (data.status === "ACTIVE" && data.user) {
            // Student auto-login: server already set the session cookie,
            // so prime the React Query cache and route to home.
            queryClient.setQueryData(getGetCurrentUserQueryKey(), data.user);
            toast({
              title: "Welcome to Knowledge Bank",
              description: `Logged in as ${data.user.displayName}.`,
            });
            setLocation("/");
          } else {
            toast({
              title: "Account submitted",
              description:
                data.message ??
                "Your lecturer account is pending admin approval.",
            });
            setLocation("/login");
          }
        },
        onError: (error: any) => {
          toast({
            variant: "destructive",
            title: "Registration failed",
            description:
              error?.data?.error?.message ?? "Please review the form and try again.",
          });
        },
      },
    );
  };

  return (
    <div id="main" tabIndex={-1} className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden outline-none">
      <div className="absolute top-0 left-0 w-full h-[40vh] bg-primary/5 rounded-b-[100%] border-b border-primary/10 pointer-events-none" />

      <Card className="w-full max-w-lg relative z-10 shadow-xl border-border/50">
        <CardHeader className="text-center pb-6 pt-10">
          <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-6 shadow-lg rotate-3">
            <Logo className="h-9 w-9 text-primary-foreground -rotate-3" />
          </div>
          <h1 className="font-serif text-3xl mb-2 font-semibold leading-none tracking-tight">
            Create your account
          </h1>
          <CardDescription className="text-base">
            Join the university's scholarly reading room.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <div className="grid grid-cols-2 gap-2 mb-6">
            <Button
              type="button"
              variant={role === "student" ? "default" : "outline"}
              className="h-auto py-3"
              onClick={() => {
                setRole("student");
                form.setValue("role", "student");
              }}
              data-testid="role-student"
            >
              <User className="mr-2 h-4 w-4" /> Student
            </Button>
            <Button
              type="button"
              variant={role === "lecturer" ? "default" : "outline"}
              className="h-auto py-3"
              onClick={() => {
                setRole("lecturer");
                form.setValue("role", "lecturer");
              }}
              data-testid="role-lecturer"
            >
              <BookA className="mr-2 h-4 w-4" /> Lecturer
            </Button>
          </div>

          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="space-y-4"
              data-testid="register-form"
            >
              <FormField
                control={form.control}
                name="fullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Full name</FormLabel>
                    <FormControl>
                      <Input placeholder="Riley Carter" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="name@university.edu"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {role === "student" ? (
                <FormField
                  control={form.control}
                  name="studentId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Student ID (optional)</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 20231234" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FormField
                    control={form.control}
                    name="lecturerId"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Lecturer ID (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. L-0042" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="department"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Department (optional)</FormLabel>
                        <FormControl>
                          <Input placeholder="e.g. Computer Science" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
              )}

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
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Confirm password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {role === "lecturer" && (
                <p className="text-xs text-muted-foreground rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 p-3">
                  Lecturer accounts require admin approval before sign-in.
                </p>
              )}

              <Button
                type="submit"
                className="w-full h-11 text-base mt-2"
                disabled={registerMutation.isPending}
                data-testid="submit-register"
              >
                {registerMutation.isPending && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Create account
              </Button>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="justify-center pb-8">
          <p className="text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
