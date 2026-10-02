// CR-71 대조군: 면제 3파일 밖의 contracts 파일이 다른 서비스의 DB 파일명을 쓰면 여전히 위반이다.
export const LEAK = 'ops.db'; // EXPECT[db/foreign-path]
