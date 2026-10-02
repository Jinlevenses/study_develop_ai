// CO-10: import { A as B }의 원 이름 A(외부 모듈의 이름)는 검사하지 않고 지역 이름 B만 검사한다.
import { Sparkles as AiMark, WandSparkles as AiEstimateMark } from "lucide-react";
export { Sparkles as AiBadgeMark } from "lucide-react";

export const MARKS = [AiMark, AiEstimateMark];
