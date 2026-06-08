import { useLogin, useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { useLocation, Link, Redirect } from "wouter";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { User, BookA, ShieldAlert, Loader2 } from "lucide-react";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

interface LoginValues {
  email: string;
  password: string;
}

export default function Login() {
  const [, setLocation] = useLocation();
  const loginMutation = useLogin();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();

  const { data: user, isLoading: isUserLoading } = useGetCurrentUser();

  // Built with `t` so validation messages localize with the active language.
  const loginSchema = useMemo(
    () =>
      z.object({
        email: z.string().min(1, { message: t("login.emailRequired") }),
        password: z.string().min(1, { message: t("login.passwordRequired") }),
      }),
    [t],
  );

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = (values: LoginValues) => {
    loginMutation.mutate({ data: values }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), data);
        toast({
          title: t("login.welcomeBack"),
          description: t("login.loggedInAs", { name: data.displayName }),
        });
        setLocation("/");
      },
      onError: (error) => {
        toast({
          variant: "destructive",
          title: t("login.loginFailed"),
          description: error?.data?.error?.message || t("login.invalidCredentials"),
        });
      }
    });
  };

  const DEMO_PASSWORD = "Demo1234!";
  const loginAsDemo = (email: string) => {
    form.setValue("email", email);
    form.setValue("password", DEMO_PASSWORD);
    onSubmit({ email, password: DEMO_PASSWORD });
  };

  if (user && !isUserLoading) {
    return <Redirect to="/" />;
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4 relative overflow-hidden">
      {/* Background: soft top arc */}
      <div className="absolute top-0 left-0 w-full h-[45vh] bg-gradient-to-b from-primary/8 via-primary/4 to-transparent pointer-events-none" />
      {/* Background: subtle bottom-right glow */}
      <div className="absolute bottom-0 right-0 w-[40vw] h-[40vh] bg-gradient-to-tl from-primary/5 to-transparent rounded-tl-[100%] pointer-events-none" />

      <Card className="w-full max-w-md relative z-10 shadow-xl border-border/60">
        <CardHeader className="text-center pb-6 pt-10">
          <div className="mx-auto w-16 h-16 bg-primary rounded-2xl flex items-center justify-center mb-5 shadow-lg rotate-3">
            <Logo className="h-9 w-9 text-primary-foreground -rotate-3" />
          </div>
          <CardTitle className="font-serif text-3xl mb-1.5">{t("common.appName")}</CardTitle>
          <CardDescription className="text-base leading-relaxed">
            {t("login.tagline")}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Quick login */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-center text-muted-foreground uppercase tracking-wider">
              {t("login.quickDemo")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {/* Student */}
              <button
                type="button"
                onClick={() => loginAsDemo("noa.student@knowledgebank.demo")}
                className="w-full flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 px-3 py-3 rounded-lg border border-border bg-card hover:bg-sky-50 hover:border-sky-300 dark:hover:bg-sky-950/20 dark:hover:border-sky-700/40 transition-all group text-start sm:text-center"
              >
                <div className="h-9 w-9 shrink-0 rounded-lg bg-sky-100 dark:bg-sky-900/40 flex items-center justify-center group-hover:bg-sky-200 dark:group-hover:bg-sky-800/40 transition-colors">
                  <User className="h-4 w-4 text-sky-700 dark:text-sky-400" />
                </div>
                <div className="sm:text-center">
                  <p className="text-sm font-semibold text-foreground leading-none">{t("login.student")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("login.studentDemo")}</p>
                </div>
              </button>

              {/* Lecturer */}
              <button
                type="button"
                onClick={() => loginAsDemo("maya.cohen@knowledgebank.demo")}
                className="w-full flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 px-3 py-3 rounded-lg border border-border bg-card hover:bg-primary/5 hover:border-primary/40 dark:hover:border-primary/30 transition-all group text-start sm:text-center"
              >
                <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center group-hover:bg-primary/15 transition-colors">
                  <BookA className="h-4 w-4 text-primary" />
                </div>
                <div className="sm:text-center">
                  <p className="text-sm font-semibold text-foreground leading-none">{t("login.lecturer")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("login.lecturerDemo")}</p>
                </div>
              </button>

              {/* Admin */}
              <button
                type="button"
                onClick={() => loginAsDemo("admin@knowledgebank.demo")}
                className="w-full flex items-center gap-3 sm:flex-col sm:items-center sm:gap-2 px-3 py-3 rounded-lg border border-border bg-card hover:bg-amber-50 hover:border-amber-300 dark:hover:bg-amber-950/20 dark:hover:border-amber-700/40 transition-all group text-start sm:text-center"
              >
                <div className="h-9 w-9 shrink-0 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center group-hover:bg-amber-200 dark:group-hover:bg-amber-800/40 transition-colors">
                  <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                </div>
                <div className="sm:text-center">
                  <p className="text-sm font-semibold text-foreground leading-none">{t("login.admin")}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{t("login.adminDemo")}</p>
                </div>
              </button>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground tracking-wider">{t("login.orSignIn")}</span>
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("login.email")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("login.emailPlaceholder")} {...field} />
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
                    <FormLabel>{t("login.password")}</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full h-11 text-base mt-2" disabled={loginMutation.isPending}>
                {loginMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                {t("login.signIn")}
              </Button>
            </form>
          </Form>
        </CardContent>

        <CardFooter className="flex flex-col gap-2 justify-center pb-8 pt-2">
          <p className="text-sm text-muted-foreground">
            {t("login.newHere")}{" "}
            <Link
              href="/register"
              className="text-primary font-medium hover:underline"
              data-testid="link-register"
            >
              {t("login.createAccount")}
            </Link>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
