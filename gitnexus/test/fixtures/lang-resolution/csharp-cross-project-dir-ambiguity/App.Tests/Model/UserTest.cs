// Test file in a directory also named "Model/" — alphabetically before
// App/Model/ (because '.' < '/'). Without the project-root-preference fix,
// `using Model;` in UserService.cs would incorrectly resolve here.
using App.Model;

namespace App.Tests.Model
{
    public class UserTest
    {
        public void TestGetName()
        {
            var u = new User();
            u.GetName();
        }
    }
}
