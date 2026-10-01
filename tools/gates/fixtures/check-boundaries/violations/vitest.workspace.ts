// fixture authored for T-00-05 (no spike counterpart): 단위 밖 루트 파일은 서비스·앱 import 가 위반(Brief 4.1.3 전 파일), packages/* 는 허용
import { ContentBody } from "@fathom/contracts";
import { hello } from "@fathom/svc-a"; // EXPECT[boundary/cross-service-import]

export default [ContentBody, hello];
