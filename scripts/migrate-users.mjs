import fs from 'fs';
import path from 'path';
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { DatabaseSync } from 'node:sqlite';

const csvRaw = `id,email,created_at,last_sign_in_at,raw_user_meta_data
14286bd2-a1bb-490f-bac5-da5b058babc2,amirhoseinpour.fx@gmail.com,2026-09-28 09:39:36.373763+00,null,"{""sub"":""14286bd2-a1bb-490f-bac5-da5b058babc2"",""email"":""amirhoseinpour.fx@gmail.com"",""full_name"":""Amir Hoseinpour"",""email_verified"":false,""phone_verified"":false}"
9def8d16-12e6-46af-bbb4-38991e7eb3e1,niwomugishabertin@gmail.com,2026-09-27 21:12:28.827552+00,2026-09-27 21:13:22.911771+00,"{""sub"":""9def8d16-12e6-46af-bbb4-38991e7eb3e1"",""email"":""niwomugishabertin@gmail.com"",""full_name"":""NIWOMUGISHA Bertin"",""email_verified"":true,""phone_verified"":false}"
541dbdec-501b-41dd-9f9e-e552d298dba9,kalibalahamza21@gmail.com,2026-09-26 23:47:34.962618+00,2026-09-27 06:43:00.352503+00,"{""sub"":""541dbdec-501b-41dd-9f9e-e552d298dba9"",""email"":""kalibalahamza21@gmail.com"",""full_name"":""Hamza Fx"",""email_verified"":true,""phone_verified"":false}"
b9376b2f-dfd2-435f-9195-b9efbe1f76bd,abdulsey16@gmail.com,2026-09-24 22:27:11.431689+00,2026-09-24 22:37:40.309594+00,"{""sub"":""b9376b2f-dfd2-435f-9195-b9efbe1f76bd"",""email"":""abdulsey16@gmail.com"",""full_name"":""Doctor.NQ"",""email_verified"":true,""phone_verified"":false}"
c93896ef-ab82-4e8d-9244-79174b198248,onyekwerenoble48@gmail.com,2026-09-23 20:20:26.866917+00,2026-09-23 20:22:36.589432+00,"{""sub"":""c93896ef-ab82-4e8d-9244-79174b198248"",""email"":""onyekwerenoble48@gmail.com"",""full_name"":""Noble chibuikem Onyekwere "",""email_verified"":true,""phone_verified"":false}"
ab2d4372-f2ac-49e9-882b-cf32c6427cdc,jithtn123@gmail.com,2026-09-14 11:28:19.455326+00,null,"{""sub"":""ab2d4372-f2ac-49e9-882b-cf32c6427cdc"",""email"":""jithtn123@gmail.com"",""full_name"":""Jithin"",""email_verified"":false,""phone_verified"":false}"
f86b8d42-9559-4631-870b-5e081225081d,dosopo3341@hideam.com,2026-09-14 10:31:26.093078+00,null,"{""sub"":""f86b8d42-9559-4631-870b-5e081225081d"",""email"":""dosopo3341@hideam.com"",""full_name"":""adgg"",""email_verified"":false,""phone_verified"":false}"
77ff2c8d-93f9-486d-99f6-d52e185e10fc,aswinasher@gmail.com,2026-09-14 06:43:30.4764+00,2026-09-14 06:43:30.540758+00,"{""iss"":""https://accounts.google.com"",""sub"":""113145207944924099022"",""name"":""Aswin Krishna vb"",""email"":""aswinasher@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIIOQUt9aeUik3x2Nj1WYX3TXeZ0IfPIhvnewLuMB678Ns3E0c0=s96-c"",""full_name"":""Aswin Krishna vb"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIIOQUt9aeUik3x2Nj1WYX3TXeZ0IfPIhvnewLuMB678Ns3E0c0=s96-c"",""provider_id"":""113145207944924099022"",""email_verified"":true,""phone_verified"":false}"
4116d4ff-91a9-41fb-859a-0c4870167505,adenalimohammed09@gmail.com,2026-09-13 16:39:54.995924+00,null,"{""sub"":""4116d4ff-91a9-41fb-859a-0c4870167505"",""email"":""adenalimohammed09@gmail.com"",""full_name"":""Dd"",""email_verified"":false,""phone_verified"":false}"
42467c12-e309-4863-b1d1-abf22f0f3c52,anonyos318@gmail.com,2026-09-13 10:21:58.067772+00,2026-09-21 13:20:25.542661+00,"{""iss"":""https://accounts.google.com"",""sub"":""112343231026222628182"",""name"":""Anony Os"",""email"":""anonyos318@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJ7qokQrZkVRvvZH-ctLDJKHqm18HonJASBU_Tjd4rQNk0qtQ=s96-c"",""full_name"":""Anony Os"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJ7qokQrZkVRvvZH-ctLDJKHqm18HonJASBU_Tjd4rQNk0qtQ=s96-c"",""provider_id"":""112343231026222628182"",""email_verified"":true,""phone_verified"":false}"
137702fc-ed94-4846-9fe7-421006fcdf29,adithyadamodar90@gmail.com,2026-09-11 16:55:04.256299+00,2026-09-11 16:55:04.308489+00,"{""iss"":""https://accounts.google.com"",""sub"":""111606646510112060591"",""name"":""Adithya Damodara"",""email"":""adithyadamodar90@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJQCYXn6OhMoHvf4PgmcYtMvHgMgPv0liVulNTXPUjjgs9yau8k=s96-c"",""full_name"":""Adithya Damodara"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJQCYXn6OhMoHvf4PgmcYtMvHgMgPv0liVulNTXPUjjgs9yau8k=s96-c"",""provider_id"":""111606646510112060591"",""email_verified"":true,""phone_verified"":false}"
4ec7d018-6a8e-4097-9796-ef8b8ec2456b,xejaram941@daugr.com,2026-09-11 09:24:08.102033+00,null,"{""sub"":""4ec7d018-6a8e-4097-9796-ef8b8ec2456b"",""email"":""xejaram941@daugr.com"",""full_name"":""dfg"",""email_verified"":false,""phone_verified"":false}"
46d1bdf9-f1a4-406e-9ad3-e05026c6139f,wekeyet811@crybio.com,2026-09-11 09:24:02.305964+00,null,"{""sub"":""46d1bdf9-f1a4-406e-9ad3-e05026c6139f"",""email"":""wekeyet811@crybio.com"",""full_name"":""SONA"",""email_verified"":false,""phone_verified"":false}"
b98e7184-745c-4c4c-b230-fb639e8e3b98,vamog97760@prorises.com,2026-09-02 17:23:51.792616+00,null,"{""sub"":""b98e7184-745c-4c4c-b230-fb639e8e3b98"",""email"":""vamog97760@prorises.com"",""full_name"":""akshay"",""email_verified"":false,""phone_verified"":false}"
9d08fd78-aa07-4307-9a97-1f9589fe8a21,danog58416@neowd.com,2026-09-02 10:03:05.035094+00,null,"{""sub"":""danog58416@neowd.com"",""email"":""danog58416@neowd.com"",""full_name"":""malu"",""email_verified"":false,""phone_verified"":false}"
f87c5a9c-e431-4cc0-b781-fa81d6bd4340,pilosih373@neowd.com,2026-08-31 20:12:11.518292+00,null,"{""sub"":""f87c5a9c-e431-4cc0-b781-fa81d6bd4340"",""email"":""pilosih373@neowd.com"",""full_name"":""ak"",""email_verified"":false,""phone_verified"":false}"
7c660867-7cb2-44f8-b135-cfb6d296ef71,naturalflowtrading261@gmail.com,2026-08-31 15:13:58.186593+00,null,"{""sub"":""7c660867-7cb2-44f8-b135-cfb6d296ef71"",""email"":""naturalflowtrading261@gmail.com"",""full_name"":""Natural Flow Trading"",""email_verified"":false,""phone_verified"":false}"
87d428a6-9498-44a9-b45e-9f90fb44cb0c,xetaga8534@neowd.com,2026-08-30 10:54:45.798204+00,null,"{""sub"":""87d428a6-9498-44a9-b45e-9f90fb44cb0c"",""email"":""xetaga8534@neowd.com"",""full_name"":""asa"",""email_verified"":false,""phone_verified"":false}"
f1fcaad8-91a5-4ef3-aab1-49418c21610d,tecot35147@neowd.com,2026-08-30 10:53:51.902821+00,null,"{""sub"":""f1fcaad8-91a5-4ef3-aab1-49418c21610d"",""email"":""tecot35147@neowd.com"",""full_name"":""asa"",""email_verified"":false,""phone_verified"":false}"
24048f15-81bb-4000-9306-769f7441bc0b,camekof228@neowd.com,2026-08-28 19:19:58.786763+00,null,"{""sub"":""24048f15-81bb-4000-9306-769f7441bc0b"",""email"":""camekof228@neowd.com"",""full_name"":""gghhj"",""email_verified"":false,""phone_verified"":false}"
42c5aa76-2051-4eb8-afe1-aec1c82e123b,jijiraj549@fanzher.com,2026-08-28 17:54:11.475534+00,null,"{""sub"":""42c5aa76-2051-4eb8-afe1-aec1c82e123b"",""email"":""jijiraj549@fanzher.com"",""full_name"":""sdrf"",""email_verified"":false,""phone_verified"":false}"
bdabbb00-20b7-494c-8ed4-5bf35ecacc6b,wapan43853@dd2car.com,2026-08-28 17:53:17.620674+00,null,"{""sub"":""bdabbb00-20b7-494c-8ed4-5bf35ecacc6b"",""email"":""wapan43853@dd2car.com"",""full_name"":""sdrf"",""email_verified"":false,""phone_verified"":false}"
85b7b48d-c031-422a-b946-b287322da092,tojapa9960@neowd.com,2026-08-28 14:31:50.553511+00,null,"{""sub"":""85b7b48d-c031-422a-b946-b287322da092"",""email"":""tojapa9960@neowd.com"",""full_name"":""Hyme"",""email_verified"":false,""phone_verified"":false}"
bbf6b199-7c9d-496a-a66e-601b9176149d,simijo9990@neowd.com,2026-08-28 14:28:43.494144+00,null,"{""sub"":""bbf6b199-7c9d-496a-a66e-601b9176149d"",""email"":""simijo9990@neowd.com"",""full_name"":""axvt"",""email_verified"":false,""phone_verified"":false}"
b1f1fc88-5a08-4d91-a849-b58d2fb26f52,wolfpackwealthacademy@gmail.com,2026-08-28 12:58:09.874607+00,null,"{""sub"":""b1f1fc88-5a08-4d91-a849-b58d2fb26f52"",""email"":""wolfpackwealthacademy@gmail.com"",""full_name"":""Wolfpack"",""email_verified"":false,""phone_verified"":false}"
248b5f05-6ec8-4780-9801-7074a5d0b654,dipakhiremath3@gmail.com,2026-08-24 11:10:11.737418+00,2026-08-24 11:10:42.578343+00,"{""sub"":""248b5f05-6ec8-4780-9801-7074a5d0b654"",""email"":""dipakhiremath3@gmail.com"",""full_name"":""Dipak Hiremath "",""email_verified"":true,""phone_verified"":false}"
90ed5228-8e94-44d1-9533-7bf5ab2707d6,aflahthayyil916@gmail.com,2026-08-24 10:49:39.709782+00,2026-08-24 10:49:39.749246+00,"{""iss"":""https://accounts.google.com"",""sub"":""110974440112903565754"",""name"":""Aflah"",""email"":""aflahthayyil916@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIdQDKABAiy3IQ9q0cPOxHsgxYujgj1u0twklbBrumwyNcxFA=s96-c"",""full_name"":""Aflah"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIdQDKABAiy3IQ9q0cPOxHsgxYujgj1u0twklbBrumwyNcxFA=s96-c"",""provider_id"":""110974440112903565754"",""email_verified"":true,""phone_verified"":false}"
e227cc9f-3fec-4e98-9701-eb53e3732b0e,cas.patel14@gmail.com,2026-08-24 10:16:03.670816+00,2026-08-24 10:16:44.357811+00,"{""sub"":""e227cc9f-3fec-4e98-9701-eb53e3732b0e"",""email"":""cas.patel14@gmail.com"",""full_name"":""Chandresh"",""email_verified"":true,""phone_verified"":false}"
cce5f24b-fc69-4b8c-ab1b-4a7db3bc1000,shaiju@gmail.com,2026-08-23 08:42:10.921246+00,2026-08-23 08:42:10.992527+00,"{""iss"":""https://accounts.google.com"",""sub"":""108127926267526119244"",""name"":""Shaiju Raman"",""email"":""shaiju@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJtNCHXkajACO_D0FWZPUzCzmjeoHDX9_sOGaHggTaqB6J10MmD=s96-c"",""full_name"":""Shaiju Raman"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJtNCHXkajACO_D0FWZPUzCzmjeoHDX9_sOGaHggTaqB6J10MmD=s96-c"",""provider_id"":""108127926267526119244"",""email_verified"":true,""phone_verified"":false}"
7ae3c146-4303-4c8b-b458-a40a9de815b5,faithhive@gmail.com,2026-08-20 23:07:16.327311+00,2026-08-20 23:10:45.254933+00,"{""sub"":""7ae3c146-4303-4c8b-b458-a40a9de815b5"",""email"":""faithhive@gmail.com"",""full_name"":""pauline faith Wanjiru ndungu"",""email_verified"":true,""phone_verified"":false}"
ed4c5eda-2b7a-4ef3-be17-8e63b72cb441,romanet59@hotmail.fr,2026-08-19 21:22:00.934069+00,null,"{""sub"":""ed4c5eda-2b7a-4ef3-be17-8e63b72cb441"",""email"":""romanet59@hotmail.fr"",""full_name"":""Romain Prin"",""email_verified"":false,""phone_verified"":false}"
d6482e50-1f82-4f13-8ecd-ba571d8f9906,hishamke12321@gmail.com,2026-08-12 15:07:06.663508+00,2026-08-12 15:07:06.684334+00,"{""iss"":""https://accounts.google.com"",""sub"":""117425437597426450943"",""name"":""Hisham ke"",""email"":""hishamke12321@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKYsR3Jvva5WUIdAiHr5uKAw3-yHSeZ4OTXuvkrXNbE5dD1Gw=s96-c"",""full_name"":""Hisham ke"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKYsR3Jvva5WUIdAiHr5uKAw3-yHSeZ4OTXuvkrXNbE5dD1Gw=s96-c"",""provider_id"":""117425437597426450943"",""email_verified"":true,""phone_verified"":false}"
ded1f0c4-3664-4625-93a7-152d0920c815,sshadhilkp@gmai.com,2026-08-12 15:04:40.665872+00,null,"{""sub"":""ded1f0c4-3664-4625-93a7-152d0920c815"",""email"":""sshadhilkp@gmai.com"",""full_name"":""Shadil"",""email_verified"":false,""phone_verified"":false}"
83f444f2-d232-40b4-aba4-209a167cde6b,tpmohameddharvesh@gmail.com,2026-08-12 15:04:37.739242+00,2026-08-12 15:04:58.759507+00,"{""sub"":""83f444f2-d232-40b4-aba4-209a167cde6b"",""email"":""tpmohameddharvesh@gmail.com"",""full_name"":""Mohamed Dharvesh"",""email_verified"":true,""phone_verified"":false}"
c0c2c71d-48a3-4046-a008-bd976d10d01d,athulullas16@gmail.com,2026-08-11 06:55:56.942731+00,2026-08-11 06:56:43.72133+00,"{""sub"":""c0c2c71d-48a3-4046-a008-bd976d10d01d"",""email"":""athulullas16@gmail.com"",""full_name"":""Athul Ullas"",""email_verified"":true,""phone_verified"":false}"
17f40562-ea63-42dc-9d61-98bc99cfee16,safvan.armino@gmail.com,2026-08-10 15:39:30.788275+00,null,"{""sub"":""17f40562-ea63-42dc-9d61-98bc99cfee16"",""email"":""safvan.armino@gmail.com"",""full_name"":""safvan"",""email_verified"":false,""phone_verified"":false}"
4c21bb83-afae-402a-9b2d-f6f2b80dafc0,nullhyphothesisfilms@gmail.com,2026-08-09 10:39:00.426055+00,2026-08-09 10:42:40.415912+00,"{""sub"":""4c21bb83-afae-402a-9b2d-f6f2b80dafc0"",""email"":""nullhyphothesisfilms@gmail.com"",""full_name"":""Null Hypho"",""email_verified"":true,""phone_verified"":false}"
8af05ec1-ba12-4824-8137-11de2a835827,suryakiran9447@gmail.com,2026-08-08 19:37:01.803467+00,2026-08-08 19:38:24.647299+00,"{""iss"":""https://accounts.google.com"",""sub"":""100400614758435076914"",""name"":""Surya"",""email"":""suryakiran9447@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIK1zu0Xk5DWv9zmtD8Ol3HmUlO_rtkhROA67prLapUFZESvP0=s96-c"",""full_name"":""Surya"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIK1zu0Xk5DWv9zmtD8Ol3HmUlO_rtkhROA67prLapUFZESvP0=s96-c"",""provider_id"":""100400614758435076914"",""email_verified"":true,""phone_verified"":false}"
9191cdc1-2b05-408e-8691-2f53f33b2593,jawharali854@gmail.com,2026-08-08 18:07:27.090705+00,2026-08-08 18:07:52.741079+00,"{""sub"":""9191cdc1-2b05-408e-8691-2f53f33b2593"",""email"":""jawharali854@gmail.com"",""full_name"":""Muhammed "",""email_verified"":true,""phone_verified"":false}"
46d704c3-fb8e-400f-ab3a-f854224a5d76,jawharali854@gnail.com,2026-08-08 18:06:13.86215+00,null,"{""sub"":""46d704c3-fb8e-400f-ab3a-f854224a5d76"",""email"":""jawharali854@gnail.com"",""full_name"":""Muhammed "",""email_verified"":false,""phone_verified"":false}"
a3cbe87e-62c8-4f05-8030-3a71f677a1b7,jasheenahaneefm@gmail.com,2026-08-08 15:41:51.964286+00,null,"{""sub"":""a3cbe87e-62c8-4f05-8030-3a71f677a1b7"",""email"":""jasheenahaneefm@gmail.com"",""full_name"":""Jasheena haneef"",""email_verified"":false,""phone_verified"":false}"
3081eb26-f511-4269-bf50-b56bf05325e9,r35314738@gmail.com,2026-08-08 12:55:21.438266+00,2026-08-08 13:00:51.456339+00,"{""iss"":""https://accounts.google.com"",""sub"":""111047842419363010810"",""name"":""ronaldo"",""email"":""r35314738@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJcEykdx9wEZ76VYbPAArSrKWVN4_Z7ZtKnjMyUWGLf9p8O6g=s96-c"",""full_name"":""ronaldo"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJcEykdx9wEZ76VYbPAArSrKWVN4_Z7ZtKnjMyUWGLf9p8O6g=s96-c"",""provider_id"":""111047842419363010810"",""email_verified"":true,""phone_verified"":false}"
a40fd3bf-3d98-4013-816d-03e4f81a7dc5,arshadppmuhammad6@gmail.com,2026-08-08 12:51:59.704151+00,null,"{""sub"":""a40fd3bf-3d98-4013-816d-03e4f81a7dc5"",""email"":""arshadppmuhammad6@gmail.com"",""full_name"":""Muhammed ARSHAD PP"",""email_verified"":false,""phone_verified"":false}"
ba1f131a-4d1c-48ca-919e-25cf16ae0d13,abdllhmlnaaa@gmail.com,2026-08-07 16:26:36.388916+00,2026-08-07 16:26:36.448475+00,"{""iss"":""https://accounts.google.com"",""sub"":""109310437726533890099"",""name"":""Abdillah Maulana"",""email"":""abdllhmlnaaa@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKMr54_f5gqE50bs9Y4t-NJ1L00y4P2hGeDX-fohmQNFzX4_g=s96-c"",""full_name"":""Abdillah Maulana"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKMr54_f5gqE50bs9Y4t-NJ1L00y4P2hGeDX-fohmQNFzX4_g=s96-c"",""provider_id"":""109310437726533890099"",""email_verified"":true,""phone_verified"":false}"
8f16d5b5-cf92-41ea-a324-29aee1c8a2b6,rka59768@gmail.com,2026-08-07 14:17:06.200272+00,2026-08-08 12:44:09.726865+00,"{""sub"":""8f16d5b5-cf92-41ea-a324-29aee1c8a2b6"",""email"":""rka59768@gmail.com"",""full_name"":""rojin"",""email_verified"":true,""phone_verified"":false}"
6887e5f9-a18e-4c43-a354-2cc4a8aafe7f,harish.void@gmail.com,2026-08-07 12:13:46.746729+00,2026-08-07 12:14:11.100098+00,"{""sub"":""6887e5f9-a18e-4c43-a354-2cc4a8aafe7f"",""email"":""harish.void@gmail.com"",""full_name"":""Harish "",""email_verified"":true,""phone_verified"":false}"
d2510a54-9603-4c58-b1db-6695ecf0c0bd,info.jeswinjames@gmail.com,2026-08-06 13:14:53.44142+00,2026-08-06 13:15:32.493314+00,"{""sub"":""d2510a54-9603-4c58-b1db-6695ecf0c0bd"",""email"":""info.jeswinjames@gmail.com"",""full_name"":""Jeswin"",""email_verified"":true,""phone_verified"":false}"
9019dc1b-1998-414b-975e-ba64661d88bc,expres2255@gmail.com,2026-08-06 07:58:02.29878+00,2026-08-06 07:59:46.315017+00,"{""sub"":""9019dc1b-1998-414b-975e-ba64661d88bc"",""email"":""expres2255@gmail.com"",""full_name"":""Abdullah Vazhayil "",""email_verified"":true,""phone_verified"":false}"
09f59c0f-5987-42a1-8e0e-e24223e6bde3,battbruceman@gmail.com,2026-08-06 06:03:03.429419+00,2026-08-06 06:03:03.466501+00,"{""iss"":""https://accounts.google.com"",""sub"":""102640531032402583885"",""name"":""Bruce Wayne"",""email"":""battbruceman@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJ6c7yX3vomiypq800mpjEA1E8lB5aeFo19tYhIJEwQN7TV_Rgp=s96-c"",""full_name"":""Bruce Wayne"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJ6c7yX3vomiypq800mpjEA1E8lB5aeFo19tYhIJEwQN7TV_Rgp=s96-c"",""provider_id"":""102640531032402583885"",""email_verified"":true,""phone_verified"":false}"
90acd1cd-0cad-47f0-8dbb-6f08ab20199c,akashkrishna7696@gmail.com,2026-08-06 05:49:02.747034+00,null,"{""sub"":""90acd1cd-0cad-47f0-8dbb-6f08ab20199c"",""email"":""akashkrishna7696@gmail.com"",""full_name"":""Akash Krishna A "",""email_verified"":false,""phone_verified"":false}"
60638e12-1184-48c2-9f3d-750685e93177,ksabik285@gmail.com,2026-08-06 05:47:59.49335+00,2026-08-06 05:47:59.534893+00,"{""iss"":""https://accounts.google.com"",""sub"":""104505368155128758230"",""name"":""Sabik MOHD"",""email"":""ksabik285@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIsQv6jFBzyVghthS8KvFG4osdjGLLZkpK-3vMRJm4hpvgFLOBb=s96-c"",""full_name"":""Sabik MOHD"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIsQv6jFBzyVghthS8KvFG4osdjGLLZkpK-3vMRJm4hpvgFLOBb=s96-c"",""provider_id"":""104505368155128758230"",""email_verified"":true,""phone_verified"":false}"
b72ea8b1-630f-4faa-a520-88484b29232b,anasmachingal123@gmail.com,2026-08-06 05:11:50.365893+00,2026-08-06 05:11:50.402385+00,"{""iss"":""https://accounts.google.com"",""sub"":""115503943604780544353"",""name"":""Anas Machingal"",""email"":""anasmachingal123@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJZDbLKm4GSI5wYl6bx9OquQRebuZ2cINCKZ45O43sjgs50jGOT=s96-c"",""full_name"":""Anas Machingal"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJZDbLKm4GSI5wYl6bx9OquQRebuZ2cINCKZ45O43sjgs50jGOT=s96-c"",""provider_id"":""115503943604780544353"",""email_verified"":true,""phone_verified"":false}"
53619833-8c65-4289-a04d-97918eb50b00,spam66819@gmail.com,2026-08-06 04:33:34.883922+00,2026-08-06 04:35:27.937848+00,"{""sub"":""53619833-8c65-4289-a04d-97918eb50b00"",""email"":""spam66819@gmail.com"",""full_name"":""Sali"",""email_verified"":true,""phone_verified"":false}"
bd99209e-b7f9-48f4-91a1-fb077e3aaac4,badruddeenmoideen@gmail.com,2026-08-06 03:48:10.944676+00,2026-08-06 03:48:10.968835+00,"{""iss"":""https://accounts.google.com"",""sub"":""104217412853189289768"",""name"":""Badruddeen Moideen"",""email"":""badruddeenmoideen@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocINYriuZi1lbD0PrQANDnztEllAMLXCibm4yCLL4vvnqBMNJw=s96-c"",""full_name"":""Badruddeen Moideen"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocINYriuZi1lbD0PrQANDnztEllAMLXCibm4yCLL4vvnqBMNJw=s96-c"",""provider_id"":""104217412853189289768"",""email_verified"":true,""phone_verified"":false}"
ab50d861-6da2-4dc3-b1f2-a24c58563136,rameezmvk@gmail.com,2026-08-06 03:42:19.083146+00,2026-08-06 03:42:19.105084+00,"{""iss"":""https://accounts.google.com"",""sub"":""110501696605301609509"",""name"":""Rameez"",""email"":""rameezmvk@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIZs4zPkT0_PXUpJg4KiZnRxVErebGnEmX1v2zpYa4U-2D2QviA=s96-c"",""full_name"":""Rameez"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIZs4zPkT0_PXUpJg4KiZnRxVErebGnEmX1v2zpYa4U-2D2QviA=s96-c"",""provider_id"":""110501696605301609509"",""email_verified"":true,""phone_verified"":false}"
3a27b9c5-0ef1-43f2-8ada-710a05fd5d05,shinasks113@gmail.com,2026-08-06 03:25:50.708368+00,2026-08-06 03:25:50.735188+00,"{""iss"":""https://accounts.google.com"",""sub"":""104980987684420703520"",""name"":""Shinas Ks"",""email"":""shinasks113@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKvhPh2KAUm0s3dxggOnrjmdIuG7PatY5MaOlkskgLm-1K8VA=s96-c"",""full_name"":""Shinas Ks"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKvhPh2KAUm0s3dxggOnrjmdIuG7PatY5MaOlkskgLm-1K8VA=s96-c"",""provider_id"":""104980987684420703520"",""email_verified"":true,""phone_verified"":false}"
c1cc951d-fa68-4695-b839-6394245370e5,ajinjinu931@gmail.com,2026-08-06 03:19:50.360108+00,2026-08-06 03:36:34.65513+00,"{""sub"":""c1cc951d-fa68-4695-b839-6394245370e5"",""email"":""ajinjinu931@gmail.com"",""full_name"":""Ajin P"",""email_verified"":true,""phone_verified"":false}"
c12fa48d-8793-426d-a602-f9232cd5a9e7,binoykottayam@gmail.com,2026-08-06 02:59:58.187884+00,2026-08-06 03:02:16.145638+00,"{""sub"":""c12fa48d-8793-426d-a602-f9232cd5a9e7"",""email"":""binoykottayam@gmail.com"",""full_name"":""Binoy"",""email_verified"":true,""phone_verified"":false}"
fefe7a2b-9f6b-4ac6-9c00-008d25fd0d5c,mediaboost.agency1@gmail.com,2026-08-05 18:01:15.677989+00,2026-08-05 18:01:31.951183+00,"{""sub"":""fefe7a2b-9f6b-4ac6-9c00-008d25fd0d5c"",""email"":""mediaboost.agency1@gmail.com"",""full_name"":""Avi"",""email_verified"":true,""phone_verified"":false}"
a2c03659-1edb-48e8-9966-b0dbc93fcd09,toragol689@bejum.com,2026-08-05 12:27:50.526109+00,null,"{""sub"":""a2c03659-1edb-48e8-9966-b0dbc93fcd09"",""email"":""toragol689@bejum.com"",""full_name"":""asde"",""email_verified"":false,""phone_verified"":false}"
48c48de7-4d0a-4548-bf21-913dc1a81775,sreejithcandoit12@gmail.com,2026-08-04 17:36:53.501394+00,2026-08-04 17:36:53.526516+00,"{""iss"":""https://accounts.google.com"",""sub"":""102962632058376477664"",""name"":""SREE JITH"",""email"":""sreejithcandoit12@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocLKtwe5dcOamoIZQXQ6PXZ47W1lP1itK-epmUZg-PGOZVrHzmpk=s96-c"",""full_name"":""SREE JITH"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocLKtwe5dcOamoIZQXQ6PXZ47W1lP1itK-epmUZg-PGOZVrHzmpk=s96-c"",""provider_id"":""102962632058376477664"",""email_verified"":true,""phone_verified"":false}"
fc89ccb1-eb02-483e-89e7-f3bc49756496,vvivekv906@gmail.com,2026-08-04 17:32:09.778559+00,2026-09-15 13:03:55.675539+00,"{""iss"":""https://accounts.google.com"",""sub"":""101308702751597936181"",""name"":""Vivek.V"",""email"":""vvivekv906@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKPBGyKNiZEYo5yulCUlzqgHYxHYXup_m5fRK6VK6qD2iS09ZXe=s96-c"",""full_name"":""Vivek.V"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKPBGyKNiZEYo5yulCUlzqgHYxHYXup_m5fRK6VK6qD2iS09ZXe=s96-c"",""provider_id"":""101308702751597936181"",""email_verified"":true,""phone_verified"":false}"
5f31bc32-2621-447a-b686-e0fc48931a72,abdillhmaulana@gmail.com,2026-08-04 16:29:39.739878+00,2026-08-05 10:05:08.933654+00,"{""iss"":""https://accounts.google.com"",""sub"":""113509748530017552002"",""name"":""Abdillah Maulana"",""email"":""abdillhmaulana@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocLXEvZOmn6EQ1ARqazwiAfLbQM7e24jCpK60C5-UhjKrzJmUg=s96-c"",""full_name"":""Abdillah Maulana"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocLXEvZOmn6EQ1ARqazwiAfLbQM7e24jCpK60C5-UhjKrzJmUg=s96-c"",""provider_id"":""113509748530017552002"",""email_verified"":true,""phone_verified"":false}"
667345ea-7cc5-4e20-b930-e046225028fc,akhiltrade10@gmail.com,2026-08-04 10:52:17.366264+00,2026-08-04 10:52:17.452863+00,"{""iss"":""https://accounts.google.com"",""sub"":""109929243109518099373"",""name"":""AKHIL JOSE"",""email"":""akhiltrade10@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJcxTcqWgQQOB-5ygHH2qybmkYhALv9sXkfKqm1rqfJRMvfCA=s96-c"",""full_name"":""AKHIL JOSE"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJcxTcqWgQQOB-5ygHH2qybmkYhALv9sXkfKqm1rqfJRMvfCA=s96-c"",""provider_id"":""109929243109518099373"",""email_verified"":true,""phone_verified"":false}"
f038a5ad-23dd-4790-8283-ed08e15d5a3e,shriamits454@gmail.com,2026-08-04 10:17:37.730943+00,2026-08-17 05:35:59.303041+00,"{""iss"":""https://accounts.google.com"",""sub"":""111563606076173843223"",""name"":""amit singh"",""email"":""shriamits454@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocI2jMedDLnvlEisA3cEbJ3zsK3sMgv90DkPMhtGRP9_18XuzNVc=s96-c"",""full_name"":""amit singh"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocI2jMedDLnvlEisA3cEbJ3zsK3sMgv90DkPMhtGRP9_18XuzNVc=s96-c"",""provider_id"":""111563606076173843223"",""email_verified"":true,""phone_verified"":false}"
c44ce33b-76a0-49d2-857e-ec0fbbc6200e,prasanthcs1999@gmail.com,2026-08-04 09:45:28.52379+00,2026-08-04 09:45:28.544114+00,"{""iss"":""https://accounts.google.com"",""sub"":""112759899071657921256"",""name"":""V3 MaNiAc"",""email"":""prasanthcs1999@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKxJnLFzcz2G3ztrri4TjJwTWSzr9rNlFudiMgpQ29w3MLDH4U5zw=s96-c"",""full_name"":""V3 MaNiAc"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKxJnLFzcz2G3ztrri4TjJwTWSzr9rNlFudiMgpQ29w3MLDH4U5zw=s96-c"",""provider_id"":""112759899071657921256"",""email_verified"":true,""phone_verified"":false}"
245d9c2c-f2af-4147-97c5-fb20111574b8,justinsurya39@gmail.com,2026-08-04 09:38:39.065914+00,2026-08-04 09:38:39.09211+00,"{""iss"":""https://accounts.google.com"",""sub"":""116014326282625263512"",""name"":""Surya Here"",""email"":""justinsurya39@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocI06vNuQgGIXnhiVkCeNMwf6cx4fvxqxqTGtuRT9XEam_4k_Y_n5g=s96-c"",""full_name"":""Surya Here"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocI06vNuQgGIXnhiVkCeNMwf6cx4fvxqxqTGtuRT9XEam_4k_Y_n5g=s96-c"",""provider_id"":""116014326282625263512"",""email_verified"":true,""phone_verified"":false}"
bec39496-7024-48a4-9247-1d6cd133577c,sarathsk0128@gmail.com,2026-08-04 08:38:40.190886+00,2026-08-04 09:34:30.429329+00,"{""sub"":""bec39496-7024-48a4-9247-1d6cd133577c"",""email"":""sarathsk0128@gmail.com"",""full_name"":""sarath kannan"",""email_verified"":true,""phone_verified"":false}"
d89e0f35-3750-4ecd-9af9-f82b533f8bad,akshaytraderfx@gmail.com,2026-08-04 08:34:18.656643+00,2026-08-04 08:34:18.698493+00,"{""iss"":""https://accounts.google.com"",""sub"":""100882029471575477288"",""name"":""Appu Appu (Appu)"",""email"":""akshaytraderfx@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJX3tR2vNeLN7mI4RcHaHse9-dzyD9EWX7SLou1SCM5C2-LoBZ5=s96-c"",""full_name"":""Appu Appu (Appu)"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJX3tR2vNeLN7mI4RcHaHse9-dzyD9EWX7SLou1SCM5C2-LoBZ5=s96-c"",""provider_id"":""100882029471575477288"",""email_verified"":true,""phone_verified"":false}"
d6d8b2c8-890c-4309-add5-7f93e87206b4,abinesh05122004@gmail.com,2026-08-04 06:32:05.898268+00,2026-08-04 06:32:05.923561+00,"{""iss"":""https://accounts.google.com"",""sub"":""115027436158795502544"",""name"":""ツABINESHツ"",""email"":""abinesh05122004@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocLRmyBN-7qmPPO-BNnY1FgHhaU2gcdGN0J-ZdHyVF3Y_fBhYSiM=s96-c"",""full_name"":""ツABINESHツ"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocLRmyBN-7qmPPO-BNnY1FgHhaU2gcdGN0J-ZdHyVF3Y_fBhYSiM=s96-c"",""provider_id"":""115027436158795502544"",""email_verified"":true,""phone_verified"":false}"
4a917335-70a7-435d-b84b-5525b19e1549,sreejithsmart77@gmail.com,2026-08-04 06:29:32.603676+00,2026-08-04 17:43:01.33461+00,"{""iss"":""https://accounts.google.com"",""sub"":""117246880248999508009"",""name"":""SREEJITH"",""email"":""sreejithsmart77@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIGzvpRfo05G6BZxHcjMF-HefvUbo86C2d288XLn_x2wUMNaEy1=s96-c"",""full_name"":""SREEJITH"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIGzvpRfo05G6BZxHcjMF-HefvUbo86C2d288XLn_x2wUMNaEy1=s96-c"",""provider_id"":""117246880248999508009"",""email_verified"":true,""phone_verified"":false}"
3e7d279f-da58-442d-a76e-f0f13d5f6be8,anandhujr15@gmail.com,2026-08-04 05:17:09.677882+00,2026-08-04 05:17:09.729132+00,"{""iss"":""https://accounts.google.com"",""sub"":""107481584001399314202"",""name"":""Anandhu Krishnan"",""email"":""anandhujr15@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJFRmjVs8HEvRypQSLiapuh3i7FIQcDJSPRaYtKEzZF5gC9_jMJ=s96-c"",""full_name"":""Anandhu Krishnan"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJFRmjVs8HEvRypQSLiapuh3i7FIQcDJSPRaYtKEzZF5gC9_jMJ=s96-c"",""provider_id"":""107481584001399314202"",""email_verified"":true,""phone_verified"":false}"
8bc4c71b-7851-4cd6-98f5-102636082a02,kunz200804@gmail.com,2026-08-04 02:56:55.413345+00,2026-08-04 10:29:28.900366+00,"{""iss"":""https://accounts.google.com"",""sub"":""104211602321832371733"",""name"":""Kunz 20"",""email"":""kunz200804@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIauCT7-K5zKHkrtEFnOhYuZrpzjQnhuBMm7CUJLX8FvRhY4Q=s96-c"",""full_name"":""Kunz 20"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIauCT7-K5zKHkrtEFnOhYuZrpzjQnhuBMm7CUJLX8FvRhY4Q=s96-c"",""provider_id"":""104211602321832371733"",""email_verified"":true,""phone_verified"":false}"
b96b6e54-007d-4bec-b43b-5adea7827dd9,paymentvai69@gmail.com,2026-08-04 02:42:24.8396+00,null,"{""sub"":""b96b6e54-007d-4bec-b43b-5adea7827dd9"",""email"":""paymentvai69@gmail.com"",""full_name"":""Vairamfx "",""email_verified"":false,""phone_verified"":false}"
4d0b3583-df07-458d-98c3-9149a7336b15,fecev33243@applamos.com,2026-08-03 19:02:52.901378+00,2026-08-03 19:02:52.94108+00,"{""sub"":""4d0b3583-df07-458d-98c3-9149a7336b15"",""email"":""fecev33243@applamos.com"",""full_name"":""aks"",""email_verified"":true,""phone_verified"":false}"
e9a62c0d-0a05-4ff5-ad0c-97d159f3f3cb,fehico9818@applamos.com,2026-08-03 18:58:30.333704+00,2026-08-03 18:58:30.363547+00,"{""sub"":""e9a62c0d-0a05-4ff5-ad0c-97d159f3f3cb"",""email"":""fehico9818@applamos.com"",""full_name"":""ammu"",""email_verified"":true,""phone_verified"":false}"
a06799b6-a9d7-4a0a-a415-54adf205a6eb,weyigev572@applamos.com,2026-08-03 18:50:15.148502+00,2026-08-03 18:50:15.206863+00,"{""sub"":""a06799b6-a9d7-4a0a-a415-54adf205a6eb"",""email"":""weyigev572@applamos.com"",""full_name"":""aks"",""email_verified"":true,""phone_verified"":false}"
b9539164-aa40-4f9d-9776-83414cd1856a,hello.aneeshpa@gmail.com,2026-08-03 18:27:09.279565+00,2026-08-03 18:27:09.327403+00,"{""iss"":""https://accounts.google.com"",""sub"":""113898699512821949868"",""name"":""Aneesh Kumar"",""email"":""hello.aneeshpa@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIV0aU4SbqLe_BqRAJyLEEaF2TU-DhFWNt59yxWMphipQMAkESc=s96-c"",""full_name"":""Aneesh Kumar"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIV0aU4SbqLe_BqRAJyLEEaF2TU-DhFWNt59yxWMphipQMAkESc=s96-c"",""provider_id"":""113898699512821949868"",""email_verified"":true,""phone_verified"":false}"
1a18558a-6a43-4098-b527-737ebc5c721b,afsalarackal11@gmail.com,2026-08-03 15:16:02.758967+00,2026-08-03 15:16:02.811478+00,"{""iss"":""https://accounts.google.com"",""sub"":""103611463563709414203"",""name"":""AFSAL ARACKAL"",""email"":""afsalarackal11@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIpw35FNYFFpqphbJK7yP4e9J3G1lZZlM-XWu0etw2QokxPfGqc=s96-c"",""full_name"":""AFSAL ARACKAL"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIpw35FNYFFpqphbJK7yP4e9J3G1lZZlM-XWu0etw2QokxPfGqc=s96-c"",""provider_id"":""103611463563709414203"",""email_verified"":true,""phone_verified"":false}"
75811119-0ad2-4747-b0c1-c56b6f5578f8,prnvkly@gmail.com,2026-08-03 11:07:32.644408+00,2026-08-03 11:07:32.669552+00,"{""iss"":""https://accounts.google.com"",""sub"":""108232019674666775786"",""name"":""Pranv Ly"",""email"":""prnvkly@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIV65JwN713o989gnVBzGRF7GbtSGr0PcOXZ9fI0B7w4RVmrw=s96-c"",""full_name"":""Pranv Ly"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIV65JwN713o989gnVBzGRF7GbtSGr0PcOXZ9fI0B7w4RVmrw=s96-c"",""provider_id"":""108232019674666775786"",""email_verified"":true,""phone_verified"":false}"
b500949f-ee1c-4916-8952-61858b3f6661,hareko7118@bejum.com,2026-08-03 10:58:33.366767+00,null,"{""sub"":""b500949f-ee1c-4916-8952-61858b3f6661"",""email"":""hareko7118@bejum.com"",""full_name"":""sasa"",""email_verified"":false,""phone_verified"":false}"
a8fe3aea-8b3b-4777-8ebc-759e464a5010,cisocic173@bejum.com,2026-08-03 10:57:27.934376+00,null,"{""sub"":""a8fe3aea-8b3b-4777-8ebc-759e464a5010"",""email"":""cisocic173@bejum.com"",""full_name"":""sasa"",""email_verified"":false,""phone_verified"":false}"
90210707-6f91-4284-9148-32c1363aca19,sanjosebi8@gmail.com,2026-08-03 09:22:24.75587+00,2026-08-03 09:22:24.800089+00,"{""iss"":""https://accounts.google.com"",""sub"":""105590197184313623079"",""name"":""Sanjo sebi"",""email"":""sanjosebi8@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocK7QY55H07YU18q4wE4nzLnwY0uboNNxYmX5KzDzxBHt2uXbFweIA=s96-c"",""full_name"":""Sanjo sebi"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocK7QY55H07YU18q4wE4nzLnwY0uboNNxYmX5KzDzxBHt2uXbFweIA=s96-c"",""provider_id"":""105590197184313623079"",""email_verified"":true,""phone_verified"":false}"
95e05916-5a96-433f-bc5d-f397e0a837c5,ajasajuff@gmail.com,2026-08-03 08:39:10.576584+00,2026-08-03 08:39:10.599519+00,"{""iss"":""https://accounts.google.com"",""sub"":""106512927286369681513"",""name"":""Ramees Rafeek"",""email"":""ajasajuff@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocLSsYHs3qVTKVv1TSGvjTwvev6Rl4QknmYlwGPzsWTq17tbjCY=s96-c"",""full_name"":""Ramees Rafeek"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocLSsYHs3qVTKVv1TSGvjTwvev6Rl4QknmYlwGPzsWTq17tbjCY=s96-c"",""provider_id"":""106512927286369681513"",""email_verified"":true,""phone_verified"":false}"
7748ba46-d469-47e2-8a70-2127ec5e681c,althafansar02@gmail.com,2026-08-03 08:34:05.679877+00,2026-08-03 08:34:05.708796+00,"{""iss"":""https://accounts.google.com"",""sub"":""109407963434638215663"",""name"":""Althaf Ansar"",""email"":""althafansar02@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKXKzApmwLgm43qtf_cBKaDGHZtrFuCfL5999t3AX0GTF5_71uqXg=s96-c"",""full_name"":""Althaf Ansar"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKXKzApmwLgm43qtf_cBKaDGHZtrFuCfL5999t3AX0GTF5_71uqXg=s96-c"",""provider_id"":""109407963434638215663"",""email_verified"":true,""phone_verified"":false}"
5ac0c0b7-aceb-4d4a-96b1-636896406918,instagramhere4@gmail.com,2026-08-03 08:23:40.546633+00,2026-08-03 08:23:40.561752+00,"{""iss"":""https://accounts.google.com"",""sub"":""113631771526174002511"",""name"":""Insta Gram"",""email"":""instagramhere4@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocKqpsivjrzVPSlQ1FtxxITfD4X2DK_IhFFWfYxgbNk4upc54g=s96-c"",""full_name"":""Insta Gram"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocKqpsivjrzVPSlQ1FtxxITfD4X2DK_IhFFWfYxgbNk4upc54g=s96-c"",""provider_id"":""113631771526174002511"",""email_verified"":true,""phone_verified"":false}"
1e84807d-bdcc-4b53-91e2-0bf2f90701ec,shakirmuhammed567@gmail.com,2026-08-03 08:23:24.948733+00,2026-08-03 08:23:24.965323+00,"{""iss"":""https://accounts.google.com"",""sub"":""103478900355398625189"",""name"":""MUHAMMED SHAKIR"",""email"":""shakirmuhammed567@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIOaDZh2-3lltcea9F__eChIS1LevnxuOBlI5e6kF2xr_1U9cUA=s96-c"",""full_name"":""MUHAMMED SHAKIR"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIOaDZh2-3lltcea9F__eChIS1LevnxuOBlI5e6kF2xr_1U9cUA=s96-c"",""provider_id"":""103478900355398625189"",""email_verified"":true,""phone_verified"":false}"
7ad96a01-ce76-4537-80e5-7163cba4ad69,riyasckworks@gmail.com,2026-08-03 08:22:59.033268+00,2026-08-03 08:22:59.083878+00,"{""iss"":""https://accounts.google.com"",""sub"":""111987169501511312208"",""name"":""Riyas CK"",""email"":""riyasckworks@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIKYLcRF4c-1Zle2664o9F7gF4ESi_TUyypxVhGKZs1kjymM397=s96-c"",""full_name"":""Riyas CK"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIKYLcRF4c-1Zle2664o9F7gF4ESi_TUyypxVhGKZs1kjymM397=s96-c"",""provider_id"":""111987169501511312208"",""email_verified"":true,""phone_verified"":false}"
f7904d10-57be-4209-8c5f-980ef9f53192,jagathtrustpip@gmail.com,2026-08-03 06:56:48.250747+00,2026-08-03 06:56:48.301807+00,"{""iss"":""https://accounts.google.com"",""sub"":""100726694044744968705"",""name"":""Jagathtrustpip"",""email"":""jagathtrustpip@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocJK625N2yQ4xsZ-F4jJ_tMd2JaXUuaOe0Hmgl2Typq0i4qW4Q=s96-c"",""full_name"":""Jagathtrustpip"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocJK625N2yQ4xsZ-F4jJ_tMd2JaXUuaOe0Hmgl2Typq0i4qW4Q=s96-c"",""provider_id"":""100726694044744968705"",""email_verified"":true,""phone_verified"":false}"
7159bcc7-fa1b-410e-ad55-87d2634fabf6,sooryaprakash2k7@gmail.com,2026-08-03 04:27:03.92511+00,2026-08-03 04:27:34.366498+00,"{""sub"":""7159bcc7-fa1b-410e-ad55-87d2634fabf6"",""email"":""sooryaprakash2k7@gmail.com"",""full_name"":""soorya prakash"",""email_verified"":true,""phone_verified"":false}"
4d05ecae-4eaf-48d6-829a-0ed005fb9c65,orofinmentor2@gmail.com,2026-08-02 16:23:31.316289+00,2026-08-02 16:23:31.357444+00,"{""iss"":""https://accounts.google.com"",""sub"":""102205580783082883376"",""name"":""Kevin Orofin"",""email"":""orofinmentor2@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocIBELJOeJBR6NX7sp6ksryQidw8sYlInUpWo-BLcLiHk76wuw=s96-c"",""full_name"":""Kevin Orofin"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocIBELJOeJBR6NX7sp6ksryQidw8sYlInUpWo-BLcLiHk76wuw=s96-c"",""provider_id"":""102205580783082883376"",""email_verified"":true,""phone_verified"":false}"
398d559c-6e1d-48f8-81c1-dacc55feadac,aayush22@duck.com,2026-08-02 11:34:07.499375+00,null,"{""sub"":""398d559c-6e1d-48f8-81c1-dacc55feadac"",""email"":""aayush22@duck.com"",""full_name"":""Aayush Namdev"",""email_verified"":false,""phone_verified"":false}"
db84e0d6-3032-4a5f-b0d9-55231f65853e,kicado2553@amupx.com,2026-08-01 13:42:30.907292+00,null,"{""sub"":""db84e0d6-3032-4a5f-b0d9-55231f65853e"",""email"":""kicado2553@amupx.com"",""full_name"":""F"",""email_verified"":false,""phone_verified"":false}"
bec0dc57-f2bc-4bc0-be01-030d82163ab4,beridem426@ayable.com,2026-08-01 12:15:22.756967+00,null,"{""sub"":""bec0dc57-f2bc-4bc0-be01-030d82163ab4"",""email"":""beridem426@ayable.com"",""full_name"":""malu"",""email_verified"":false,""phone_verified"":false}"
34d88f98-d529-464e-814a-f20e60efae59,jalolep980@applamos.com,2026-08-01 12:13:44.992756+00,null,"{""sub"":""34d88f98-d529-464e-814a-f20e60efae59"",""email"":""jalolep980@applamos.com"",""full_name"":""Akshay"",""email_verified"":false,""phone_verified"":false}"
87babdc2-f299-411c-a8e6-2d92553d3a21,anamikashanmugan@gmail.com,2026-07-31 04:44:48.180508+00,2026-07-31 17:01:25.340776+00,"{""iss"":""https://accounts.google.com"",""sub"":""113265690344096554573"",""name"":""Anamika shanmugan"",""email"":""anamikashanmugan@gmail.com"",""picture"":""https://lh3.googleusercontent.com/a/ACg8ocLuO0ZPQML7H2Ik89neQ4h56VSoRxzkfyD3oTbcvLi17-Pd-w=s96-c"",""full_name"":""Anamika shanmugan"",""avatar_url"":""https://lh3.googleusercontent.com/a/ACg8ocLuO0ZPQML7H2Ik89neQ4h56VSoRxzkfyD3oTbcvLi17-Pd-w=s96-c"",""provider_id"":""113265690344096554573"",""email_verified"":true,""phone_verified"":false}"
ee79b920-83a6-4983-815e-ba0a87900416,abhinath215@gmail.com,2026-07-31 04:29:57.347065+00,2026-07-31 04:33:01.831931+00,"{""sub"":""ee79b920-83a6-4983-815e-ba0a87900416"",""email"":""abhinath215@gmail.com"",""full_name"":""abhiongreed"",""email_verified"":true,""phone_verified"":false}"
25e7abe4-30c0-40e2-9ced-dd74ea7533e9,lodib75681@jobraux.com,2026-07-30 18:12:12.781915+00,null,"{""sub"":""25e7abe4-30c0-40e2-9ced-dd74ea7533e9"",""email"":""lodib75681@jobraux.com"",""full_name"":""bmanadf"",""email_verified"":false,""phone_verified"":false}"
91b0b276-0247-416f-b00c-fe7d509d8ecb,xociro2861@jobraux.com,2026-07-30 18:08:23.227738+00,2026-07-30 18:08:23.256424+00,"{""sub"":""91b0b276-0247-416f-b00c-fe7d509d8ecb"",""email"":""xociro2861@jobraux.com"",""full_name"":""anamika"",""email_verified"":true,""phone_verified"":false}"
1e2fff83-24ad-49ed-a70c-6845696d6a24,bmine4ever777@gmail.com,2026-07-30 17:46:20.623482+00,null,"{""sub"":""1e2fff83-24ad-49ed-a70c-6845696d6a24"",""email"":""bmine4ever777@gmail.com"",""full_name"":""bman"",""email_verified"":false,""phone_verified"":false}"`;

function parseCsv(csv) {
  const lines = csv.trim().split('\n');
  const result = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse line: id, email, created_at, last_sign_in_at, raw_user_meta_data
    // Note raw_user_meta_data is quoted JSON with escaped quotes ("")
    const match = line.match(/^([^,]+),([^,]+),([^,]+),([^,]+),"(.*)"$/);
    if (match) {
      const id = match[1];
      const email = match[2];
      const createdAt = match[3];
      const lastSignInAt = match[4] === 'null' ? null : match[4];
      const rawJson = match[5].replace(/""/g, '"');
      let meta = {};
      try {
        meta = JSON.parse(rawJson);
      } catch (e) {
        console.error('Failed to parse meta for', email, e.message);
      }
      result.push({
        id,
        email,
        createdAt,
        lastSignInAt,
        name: meta.full_name || meta.name || email.split('@')[0],
        avatar: meta.avatar_url || meta.picture || null,
        isEmailVerified: meta.email_verified ?? (lastSignInAt !== null),
        provider: meta.iss?.includes('google') ? 'google' : 'email'
      });
    } else {
      console.warn('Line did not match regex:', line);
    }
  }
  return result;
}

const users = parseCsv(csvRaw);
console.log(`Parsed ${users.length} users successfully.`);

async function migrate() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase URL or Service Role Key missing!');
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  // 1. Fetch existing users in public.users
  const { data: existingPublicUsers, error: pubErr } = await supabase.from('users').select('id, email');
  if (pubErr) {
    console.error('Error fetching existing public users:', pubErr);
  }
  const existingPublicEmailMap = new Map((existingPublicUsers || []).map(u => [u.email.toLowerCase(), u]));
  const existingPublicIdMap = new Map((existingPublicUsers || []).map(u => [u.id, u]));

  console.log(`Current public.users in Supabase: ${existingPublicUsers?.length || 0}`);

  // 2. Fetch existing auth users
  const { data: authList } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const existingAuthEmailMap = new Map((authList?.users || []).map(u => [u.email.toLowerCase(), u]));

  console.log(`Current auth.users in Supabase: ${authList?.users?.length || 0}`);

  let publicInserted = 0;
  let publicUpdated = 0;
  let authCreated = 0;

  for (const u of users) {
    const cleanEmail = u.email.toLowerCase().trim();

    // A. Check / Upsert in Supabase public.users
    const existing = existingPublicEmailMap.get(cleanEmail);
    const targetId = existing ? existing.id : u.id;

    const publicUserData = {
      id: targetId,
      email: cleanEmail,
      name: u.name,
      is_email_verified: !!u.isEmailVerified,
      created_at: u.createdAt,
      last_login: u.lastSignInAt,
      auth_provider: u.provider,
      status: 'ACTIVE',
      role: cleanEmail === 'akshayrajak222@gmail.com' ? 'SUPER_ADMIN' : 'USER',
      plan: 'free',
      is_pro: false,
      onboarding_completed: true,
      preferences: u.avatar ? { avatar: u.avatar } : {}
    };

    if (existing) {
      const { error } = await supabase.from('users').update({
        name: existing.name || u.name,
        is_email_verified: true,
        last_login: u.lastSignInAt || existing.last_login
      }).eq('id', existing.id);
      if (!error) publicUpdated++;
    } else {
      const { error } = await supabase.from('users').insert(publicUserData);
      if (error) {
        console.error(`Error inserting user ${cleanEmail}:`, error.message);
      } else {
        publicInserted++;
        existingPublicEmailMap.set(cleanEmail, publicUserData);
      }
    }

    // B. Check / Create in Supabase auth.users
    if (!existingAuthEmailMap.has(cleanEmail)) {
      try {
        const { data: newAuthUser, error: authErr } = await supabase.auth.admin.createUser({
          id: targetId,
          email: cleanEmail,
          email_confirm: !!u.isEmailVerified,
          user_metadata: {
            full_name: u.name,
            avatar_url: u.avatar
          }
        });
        if (authErr) {
          // If already exists with another ID or error
          // console.warn(`Auth create note for ${cleanEmail}:`, authErr.message);
        } else {
          authCreated++;
          existingAuthEmailMap.set(cleanEmail, newAuthUser.user);
        }
      } catch (e) {
        // ignore
      }
    }
  }

  console.log(`Supabase Migration Summary:`);
  console.log(`- New users inserted into public.users: ${publicInserted}`);
  console.log(`- Existing users updated in public.users: ${publicUpdated}`);
  console.log(`- Users created in auth.users: ${authCreated}`);

  // 3. Migrate into local db.json
  try {
    const dbFile = path.join(process.cwd(), 'db.json');
    if (fs.existsSync(dbFile)) {
      const localDb = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
      if (!localDb.users) localDb.users = [];
      const localEmailMap = new Map(localDb.users.map(u => [u.email.toLowerCase(), u]));
      let localAdded = 0;

      for (const u of users) {
        const cleanEmail = u.email.toLowerCase().trim();
        if (!localEmailMap.has(cleanEmail)) {
          localDb.users.push({
            id: u.id,
            email: cleanEmail,
            name: u.name,
            avatar: u.avatar,
            role: cleanEmail === 'akshayrajak222@gmail.com' ? 'SUPER_ADMIN' : 'USER',
            isPro: false,
            status: 'ACTIVE',
            createdAt: u.createdAt
          });
          localAdded++;
        }
      }
      fs.writeFileSync(dbFile, JSON.stringify(localDb, null, 2), 'utf8');
      console.log(`- Users synced into local db.json: ${localAdded} added (Total in db.json: ${localDb.users.length})`);
    }
  } catch (err) {
    console.error('Error syncing db.json:', err.message);
  }

  // 4. Migrate into auth.sqlite (Better Auth)
  try {
    const sqlitePath = path.join(process.cwd(), 'auth.sqlite');
    if (fs.existsSync(sqlitePath)) {
      const db = new DatabaseSync(sqlitePath);
      const existingSqliteUsers = db.prepare('SELECT email FROM user').all();
      const sqliteEmailSet = new Set(existingSqliteUsers.map(u => u.email.toLowerCase()));

      const insertStmt = db.prepare(`
        INSERT INTO user (
          id, name, email, emailVerified, image, createdAt, updatedAt, role, status, onboardingCompleted, isPro
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )
      `);

      let sqliteAdded = 0;
      for (const u of users) {
        const cleanEmail = u.email.toLowerCase().trim();
        if (!sqliteEmailSet.has(cleanEmail)) {
          const now = new Date().toISOString();
          insertStmt.run(
            u.id,
            u.name,
            cleanEmail,
            u.isEmailVerified ? 1 : 0,
            u.avatar || null,
            u.createdAt || now,
            now,
            cleanEmail === 'akshayrajak222@gmail.com' ? 'SUPER_ADMIN' : 'user',
            'ACTIVE',
            1,
            0
          );
          sqliteAdded++;
          sqliteEmailSet.add(cleanEmail);
        }
      }
      console.log(`- Users synced into auth.sqlite: ${sqliteAdded} added (Total in sqlite: ${sqliteEmailSet.size})`);
    }
  } catch (err) {
    console.error('Error syncing auth.sqlite:', err.message);
  }

  console.log('\nMigration completed successfully! 🎉');
}

migrate().catch(console.error);
