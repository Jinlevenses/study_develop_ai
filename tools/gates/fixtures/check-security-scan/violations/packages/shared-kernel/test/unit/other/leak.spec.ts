// CR-76 대조군: 같은 리터럴이 redact 밖 테스트 경로에 있으면 위반이다.
export const FAKE_KEY = 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx'; // EXPECT[security/secret-literal]
