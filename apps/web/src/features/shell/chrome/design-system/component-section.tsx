import { Banner } from '@fathom/ui/components/banner';
import { Button } from '@fathom/ui/components/button';
import { Card } from '@fathom/ui/components/card';
import { Checkbox } from '@fathom/ui/components/checkbox';
import { Dialog, DialogContent, DialogTrigger } from '@fathom/ui/components/dialog';
import { Drawer, DrawerContent, DrawerTrigger } from '@fathom/ui/components/drawer';
import { EmptyState } from '@fathom/ui/components/empty-state';
import { ErrorPanel } from '@fathom/ui/components/error-panel';
import { IconButton } from '@fathom/ui/components/icon-button';
import { Input } from '@fathom/ui/components/input';
import { Kbd } from '@fathom/ui/components/kbd';
import { Meter } from '@fathom/ui/components/meter';
import { Popover, PopoverContent, PopoverTrigger } from '@fathom/ui/components/popover';
import { Progress } from '@fathom/ui/components/progress';
import { RadioGroup } from '@fathom/ui/components/radio-group';
import { Select } from '@fathom/ui/components/select';
import { Skeleton } from '@fathom/ui/components/skeleton';
import { Stepper } from '@fathom/ui/components/stepper';
import { Switch } from '@fathom/ui/components/switch';
import { Tabs } from '@fathom/ui/components/tabs';
import { Textarea } from '@fathom/ui/components/textarea';
import { Tooltip } from '@fathom/ui/components/tooltip';
import { Construction, Info } from 'lucide-react';
import { type ReactElement, type ReactNode, useState } from 'react';

function Group({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-base text-fg">{title}</h3>
      <div className="flex flex-wrap items-start gap-3">{children}</div>
    </div>
  );
}

const noop = (): void => undefined;
const SELECT_OPTIONS = [
  { value: 'a', label: '선택지 가' },
  { value: 'b', label: '선택지 나' },
] as const;

/** 컴포넌트 변형·상태(default·disabled·invalid·loading) 1개씩 — 오버레이는 트리거 버튼만 둔다(DS-01 §15). */
export function ComponentSection(): ReactElement {
  const [checked, setChecked] = useState(false);
  const [on, setOn] = useState(true);
  const [radio, setRadio] = useState('a');
  const [select, setSelect] = useState('a');
  return (
    <section aria-labelledby="ds-components" className="flex flex-col gap-5">
      <h2 id="ds-components" className="text-lg text-fg">
        컴포넌트
      </h2>
      <Group title="Button">
        <Button>기본</Button>
        <Button variant="secondary">보조</Button>
        <Button variant="ghost">고스트</Button>
        <Button variant="danger">위험</Button>
        <Button variant="link">링크</Button>
        <Button disabled>비활성</Button>
        <Button loading>불러오는 중</Button>
        <Button kbd={['Mod', 'K']} variant="secondary">
          단축키
        </Button>
        <IconButton aria-label="정보" icon={Info} />
      </Group>
      <Group title="입력">
        <Input aria-label="기본 입력" placeholder="기본" />
        <Input aria-label="비활성 입력" placeholder="비활성" disabled />
        <Input aria-label="오류 입력" placeholder="오류" invalid errorMessage="값을 확인해 주세요" />
        <Textarea aria-label="여러 줄 입력" placeholder="여러 줄" />
        <Select aria-label="선택" options={SELECT_OPTIONS} value={select} onValueChange={setSelect} />
        <Select aria-label="비활성 선택" options={SELECT_OPTIONS} value="a" disabled />
      </Group>
      <Group title="선택 컨트롤">
        <Checkbox label="체크박스" checked={checked} onCheckedChange={(v) => setChecked(v === true)} />
        <Checkbox label="비활성 체크박스" checked={false} disabled />
        <Switch label="스위치" checked={on} onCheckedChange={setOn} />
        <Switch label="비활성 스위치" checked={false} disabled />
        <RadioGroup aria-label="라디오" options={SELECT_OPTIONS} value={radio} onValueChange={setRadio} />
      </Group>
      <Group title="탭·진행">
        <Tabs
          items={[
            { value: 'one', label: '첫째', content: <span className="text-sm">첫째 내용</span> },
            { value: 'two', label: '둘째', content: <span className="text-sm">둘째 내용</span> },
          ]}
          defaultValue="one"
          aria-label="탭 예시"
        />
        <Progress label="세션 진행" value={3} max={12} />
        <Meter label="준비도" value={6} max={10} valueText="10개 중 6개" />
        <Stepper
          variant="pipeline"
          aria-label="진행 단계"
          steps={[
            { id: 's1', label: '읽기', state: 'done' },
            { id: 's2', label: '풀기', state: 'current' },
            { id: 's3', label: '돌아보기', state: 'todo' },
          ]}
        />
      </Group>
      <Group title="카드·안내">
        <Card heading="기본 카드">기본</Card>
        <Card heading="선택됨" variant="selected">
          선택
        </Card>
        <Card heading="정답" variant="correct">
          정답
        </Card>
        <Card heading="오답" variant="incorrect">
          오답
        </Card>
        <Card heading="부분 정답" variant="partial">
          부분
        </Card>
        <Banner severity="info" title="안내 배너" />
        <Banner severity="warn" title="주의 배너" />
        <Banner severity="critical" title="중요 배너" />
        <Skeleton shape="block" delayMs={0} className="h-12 w-40" />
      </Group>
      <Group title="빈 상태·오류">
        <EmptyState
          icon={Construction}
          title="비어 있습니다"
          description="표시할 항목이 없습니다"
          action={{ label: '돌아가기', onSelect: noop }}
        />
        <ErrorPanel
          problem={{ title: '오류 예시', code: 'GW-INTERNAL-001' }}
          actions={[{ label: '다시 시도', onSelect: noop }]}
        />
        <Kbd keys={['Mod', 'Shift', 'F']} />
      </Group>
      <Group title="오버레이(트리거)">
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="secondary">다이얼로그</Button>
          </DialogTrigger>
          <DialogContent title="다이얼로그 예시" description="트리거 확인용입니다">
            <span className="text-sm">내용</span>
          </DialogContent>
        </Dialog>
        <Drawer>
          <DrawerTrigger asChild>
            <Button variant="secondary">드로어</Button>
          </DrawerTrigger>
          <DrawerContent title="드로어 예시">
            <span className="text-sm">내용</span>
          </DrawerContent>
        </Drawer>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="secondary">팝오버</Button>
          </PopoverTrigger>
          <PopoverContent>
            <span className="text-sm">팝오버 내용</span>
          </PopoverContent>
        </Popover>
        <Tooltip content="툴팁 내용">
          <Button variant="secondary">툴팁</Button>
        </Tooltip>
      </Group>
    </section>
  );
}
