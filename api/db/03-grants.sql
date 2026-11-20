set role bara_edu_service;

grant usage on schema public to bara_edu_anon, bara_edu_authenticated;
grant select, insert, update, delete on all tables in schema public to bara_edu_anon, bara_edu_authenticated;
grant usage on all sequences in schema public to bara_edu_anon, bara_edu_authenticated;
grant execute on all functions in schema public to bara_edu_anon, bara_edu_authenticated;

revoke execute on function public.purge_unverified_signups() from public, bara_edu_anon, bara_edu_authenticated;
revoke execute on function public.purge_old_admin_access_logs() from public, bara_edu_anon, bara_edu_authenticated;
revoke execute on function public.claim_diagnosis(uuid) from bara_edu_anon;
revoke execute on function public.get_diagnosis_detail(uuid) from bara_edu_anon;
revoke execute on function public.purge_unclaimed_diagnosis_pii() from public, bara_edu_anon, bara_edu_authenticated;
revoke execute on function public.purge_old_diagnosis_leads() from public, bara_edu_anon, bara_edu_authenticated;
revoke execute on function public.get_my_diagnosis_results() from bara_edu_anon;

reset role;
